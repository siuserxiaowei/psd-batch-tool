import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FileSpreadsheet,
  FlaskConical,
  ImagePlus,
  Layers,
  Loader2,
  MousePointer2,
  RefreshCcw,
  Upload,
  Wand2,
} from 'lucide-react'
import JSZip from 'jszip'
import { readSheet } from 'read-excel-file/browser'
import { readPsd, type Layer, type Psd } from 'ag-psd'
import './App.css'

type SlotMode = 'fill' | 'fit' | 'stretch'
type SlotType = 'image' | 'text'
type LayerKind = 'group' | 'image' | 'text'

type FlatLayer = {
  id: string
  name: string
  path: string
  depth: number
  kind: LayerKind
  hidden: boolean
  width: number
  height: number
  layer: Layer
}

type SlotConfig = {
  id: string
  name: string
  path: string
  alias: string
  type: SlotType
  mode: SlotMode
  fontSize?: number
  color?: string
  align?: CanvasTextAlign
  weight?: number
}

type ImageAsset = {
  file: File
  name: string
  stem: string
  url: string
  image: HTMLImageElement
}

type RowData = Record<string, string | number | boolean | null | undefined>

type DownloadState = {
  url: string
  name: string
  size: number
}

const modeLabels: Record<SlotMode, string> = {
  fill: '铺满',
  fit: '完整',
  stretch: '拉伸',
}

const slotTypeLabels: Record<SlotType, string> = {
  image: '图片',
  text: '文字',
}

const blendModes: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
}

const getLayerName = (layer: Layer, fallback: string) => {
  const raw = typeof layer.name === 'string' ? layer.name.trim() : ''
  return raw || fallback
}

const toAlias = (name: string, used: Set<string>) => {
  const cleaned =
    name
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^\u4e00-\u9fa5\w.-]/g, '')
      .replace(/^_+|_+$/g, '') || 'slot'
  let alias = cleaned
  let index = 2
  while (used.has(alias.toLowerCase())) {
    alias = `${cleaned}_${index}`
    index += 1
  }
  used.add(alias.toLowerCase())
  return alias
}

const normalizeKey = (value: unknown) =>
  String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.toLowerCase() || ''

const stripExtension = (value: string) => value.replace(/\.[^.]+$/, '')

const safeName = (value: string) =>
  value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'poster'

const imageFromFile = (file: File) =>
  new Promise<ImageAsset>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () =>
      resolve({
        file,
        name: file.name,
        stem: stripExtension(file.name),
        url,
        image,
      })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`图片无法读取：${file.name}`))
    }
    image.src = url
  })

const fileFromCanvas = (canvas: HTMLCanvasElement, name: string) =>
  new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`测试图片生成失败：${name}`))
        return
      }
      resolve(new File([blob], name, { type: 'image/png' }))
    }, 'image/png')
  })

const parseCsv = (text: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quote = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '"' && quote && next === '"') {
      cell += '"'
      index += 1
    } else if (char === '"') {
      quote = !quote
    } else if (char === ',' && !quote) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quote) {
      if (char === '\r' && next === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

const matrixToRows = (matrix: unknown[][]): RowData[] => {
  const [headerRow, ...body] = matrix
  const headers = (headerRow || []).map((cell) => String(cell ?? '').trim())
  return body
    .map((line) => {
      const row: RowData = {}
      headers.forEach((header, index) => {
        if (!header) return
        const value = line[index]
        row[header] = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').trim()
      })
      return row
    })
    .filter((row) => Object.values(row).some((value) => String(value ?? '').trim()))
}

const parseRows = async (file: File): Promise<RowData[]> => {
  if (/\.csv$/i.test(file.name)) {
    return matrixToRows(parseCsv(await file.text()))
  }
  const rows = await readSheet(file)
  return matrixToRows(rows)
}

const hasCanvas = (layer: Layer) => Boolean(layer.canvas)

const isGroup = (layer: Layer): layer is Layer & { children: Layer[] } => Array.isArray(layer.children)

const isText = (layer: Layer) => 'text' in layer

const layerBox = (layer: Layer) => {
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const width = Math.max(0, (layer.right ?? left + (layer.canvas?.width ?? 0)) - left)
  const height = Math.max(0, (layer.bottom ?? top + (layer.canvas?.height ?? 0)) - top)
  return { left, top, width, height }
}

const inferSlotType = (item: Pick<FlatLayer, 'kind' | 'name'>): SlotType => {
  if (item.kind === 'text') return 'text'
  return /(文字|文案|标题|价格|姓名|名字|名称|标签|价|name|text|title|price|label)/i.test(item.name)
    ? 'text'
    : 'image'
}

const defaultTextSize = (height: number) => Math.max(14, Math.min(96, Math.round(height * 0.72)))

const slotFromLayer = (item: FlatLayer, used: Set<string>): SlotConfig => {
  const type = inferSlotType(item)
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    alias: toAlias(item.name.replace(/_?替换$/i, ''), used),
    type,
    mode: 'fill',
    fontSize: type === 'text' ? defaultTextSize(item.height) : undefined,
    color: type === 'text' ? '#ffffff' : undefined,
    align: 'center',
    weight: 850,
  }
}

const flattenLayers = (children: Layer[] = [], parent = '', depth = 0): FlatLayer[] => {
  return children.flatMap((layer, index) => {
    const id = parent ? `${parent}.${index}` : `${index}`
    const name = getLayerName(layer, `图层 ${index + 1}`)
    const { width, height } = layerBox(layer)
    const item: FlatLayer = {
      id,
      name,
      path: parent ? `${parent}/${name}` : name,
      depth,
      kind: isGroup(layer) ? 'group' : isText(layer) ? 'text' : 'image',
      hidden: Boolean(layer.hidden),
      width,
      height,
      layer,
    }
    return isGroup(layer)
      ? [item, ...flattenLayers(layer.children, id, depth + 1)]
      : [item]
  })
}

const pickDefaultSlots = (layers: FlatLayer[]) => {
  const used = new Set<string>()
  const usable = layers.filter((item) => hasCanvas(item.layer) && !item.hidden && item.width > 40 && item.height > 40)
  const preferred = usable.filter((item) => !/(背景|底图|background|bg|backdrop)/i.test(item.name))
  const source = preferred.length ? preferred : usable

  return source
    .filter((item) => hasCanvas(item.layer) && !item.hidden && item.width > 40 && item.height > 40)
    .sort((a, b) => {
      const aBoost = /(商品|产品|主图|图片|换图|替换|image|photo|product|replace)/i.test(a.name) ? 10_000_000 : 0
      const bBoost = /(商品|产品|主图|图片|换图|替换|image|photo|product|replace)/i.test(b.name) ? 10_000_000 : 0
      return b.width * b.height + bBoost - (a.width * a.height + aBoost)
    })
    .slice(0, 4)
    .map<SlotConfig>((item) => slotFromLayer(item, used))
}

const buildDemoSlots = (layers: FlatLayer[]) => {
  const productSlot = layers.find((item) => item.name === '商品图_替换')
  const labelSlot = layers.find((item) => item.name === '角标文案_替换')
  const priceSlot = layers.find((item) => item.name === '价格_替换')
  const slots: SlotConfig[] = []

  if (productSlot) {
    slots.push({
      id: productSlot.id,
      name: productSlot.name,
      path: productSlot.path,
      alias: '商品图',
      type: 'image',
      mode: 'fill',
    })
  }

  if (labelSlot) {
    slots.push({
      id: labelSlot.id,
      name: labelSlot.name,
      path: labelSlot.path,
      alias: '角标文案',
      type: 'text',
      mode: 'fill',
      fontSize: 28,
      color: '#fffaf0',
      align: 'center',
      weight: 850,
    })
  }

  if (priceSlot) {
    slots.push({
      id: priceSlot.id,
      name: priceSlot.name,
      path: priceSlot.path,
      alias: '价格',
      type: 'text',
      mode: 'fill',
      fontSize: 52,
      color: '#fffaf0',
      align: 'center',
      weight: 900,
    })
  }

  return slots.length ? slots : pickDefaultSlots(layers)
}

const createCanvas = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  return canvas
}

const makeDemoPsd = (): Psd => {
  const width = 900
  const height = 1200
  const background = createCanvas(width, height, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#f7efe0')
    gradient.addColorStop(0.55, '#f5f7f2')
    gradient.addColorStop(1, '#dbeae5')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#233f40'
    ctx.fillRect(0, 0, width, 118)
    ctx.fillStyle = 'rgba(45, 75, 78, 0.08)'
    for (let x = -120; x < width; x += 58) {
      ctx.fillRect(x, 840, 36, 420)
    }
  })

  const product = createCanvas(520, 620, (ctx) => {
    ctx.fillStyle = '#f8fbf7'
    ctx.fillRect(0, 0, 520, 620)
    ctx.strokeStyle = '#9eb7ae'
    ctx.lineWidth = 8
    ctx.strokeRect(4, 4, 512, 612)
    ctx.fillStyle = '#dfe9e3'
    ctx.beginPath()
    ctx.roundRect(74, 110, 372, 372, 24)
    ctx.fill()
    ctx.fillStyle = '#2d4b4e'
    ctx.font = '700 42px Avenir Next, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('PRODUCT', 260, 320)
    ctx.font = '500 24px Avenir Next, sans-serif'
    ctx.fillText('replace layer', 260, 360)
  })

  const headline = createCanvas(760, 150, (ctx) => {
    ctx.fillStyle = '#233f40'
    ctx.font = '800 64px Avenir Next, PingFang SC, sans-serif'
    ctx.fillText('夏日上新主推', 0, 72)
    ctx.fillStyle = '#6f7f78'
    ctx.font = '500 28px Avenir Next, PingFang SC, sans-serif'
    ctx.fillText('活动海报模板 · 图片槽位可批量替换', 2, 122)
  })

  const priceBadge = createCanvas(230, 132, (ctx) => {
    ctx.fillStyle = '#d29b37'
    ctx.beginPath()
    ctx.roundRect(0, 0, 230, 132, 18)
    ctx.fill()
  })

  const priceLabel = createCanvas(112, 34, (ctx) => {
    ctx.fillStyle = '#fffaf0'
    ctx.font = '800 28px Avenir Next, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('限时价', 56, 17)
  })

  const priceValue = createCanvas(150, 58, (ctx) => {
    ctx.fillStyle = '#fffaf0'
    ctx.font = '900 52px Avenir Next, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('¥199', 75, 31)
  })

  const logo = createCanvas(240, 64, (ctx) => {
    ctx.fillStyle = '#f9f7ef'
    ctx.font = '800 30px Avenir Next, sans-serif'
    ctx.fillText('DONT STUDIO', 0, 42)
  })

  const psd: Psd = {
    width,
    height,
    children: [
      { name: '品牌_LOGO', top: 28, left: 48, bottom: 92, right: 288, canvas: logo },
      { name: '价格_替换', top: 886, left: 634, bottom: 944, right: 784, canvas: priceValue, text: { text: '¥199' } },
      { name: '角标文案_替换', top: 842, left: 652, bottom: 876, right: 764, canvas: priceLabel, text: { text: '限时价' } },
      { name: '黄色价格底框', top: 828, left: 594, bottom: 960, right: 824, canvas: priceBadge },
      { name: '标题文案', top: 144, left: 70, bottom: 294, right: 830, canvas: headline },
      { name: '商品图_替换', top: 330, left: 190, bottom: 950, right: 710, canvas: product },
      { name: '背景', top: 0, left: 0, bottom: height, right: width, canvas: background },
    ],
    canvas: background,
  }
  return psd
}

const makeDemoProductFiles = async () => {
  const specs = [
    { name: 'product-a.png', hue: '#2f6f73', accent: '#d7a23d', label: 'A款' },
    { name: 'product-b.png', hue: '#8f4e45', accent: '#233f40', label: 'B款' },
    { name: 'product-c-wide.png', hue: '#435f8a', accent: '#ead9b8', label: '横版' },
    { name: 'product-d-tall.png', hue: '#5d7656', accent: '#1f3a31', label: '竖版' },
  ]

  const files = await Promise.all(
    specs.map((spec, index) => {
      const wide = spec.name.includes('wide')
      const tall = spec.name.includes('tall')
      const width = wide ? 900 : tall ? 420 : 700
      const height = wide ? 500 : tall ? 900 : 700
      const canvas = createCanvas(width, height, (ctx) => {
        ctx.fillStyle = '#fbfaf2'
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = spec.hue
        ctx.beginPath()
        ctx.roundRect(width * 0.14, height * 0.12, width * 0.72, height * 0.72, 38)
        ctx.fill()
        ctx.fillStyle = spec.accent
        ctx.beginPath()
        ctx.arc(width * 0.72, height * 0.25, Math.min(width, height) * 0.11, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.font = `800 ${Math.round(Math.min(width, height) * 0.12)}px Avenir Next, PingFang SC, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(spec.label, width / 2, height / 2)
        ctx.font = `600 ${Math.round(Math.min(width, height) * 0.045)}px Avenir Next, sans-serif`
        ctx.fillText(`TEST ${index + 1}`, width / 2, height / 2 + Math.min(width, height) * 0.13)
      })
      return fileFromCanvas(canvas, spec.name)
    }),
  )
  return Promise.all(files.map(imageFromFile))
}

const getRowLabel = (row: RowData, index: number, fallback?: string) => {
  const candidates = ['页面名称', '名称', '文件名', 'name', 'filename', 'title', '__name']
  const value = candidates.map((key) => row[key]).find((item) => String(item ?? '').trim())
  return safeName(String(value ?? fallback ?? `poster_${index + 1}`))
}

function resolveImageForSlot(
  row: RowData,
  slot: SlotConfig,
  images: ImageAsset[],
  imageIndex: Map<string, ImageAsset>,
) {
  const keys = [slot.alias, slot.name, slot.path, stripExtension(slot.alias)]
  const raw = keys.map((key) => row[key]).find((item) => String(item ?? '').trim())
  if (!raw) return undefined

  const normalized = normalizeKey(raw)
  const stem = stripExtension(normalized)
  return imageIndex.get(normalized) || imageIndex.get(stem) || images.find((item) => item.stem.toLowerCase() === stem)
}

function resolveVisibility(row: RowData, slot: SlotConfig) {
  const raw =
    row[`show:${slot.alias}`] ??
    row[`显示:${slot.alias}`] ??
    row[`visible:${slot.alias}`] ??
    row[`hide:${slot.alias}`] ??
    row[`隐藏:${slot.alias}`]

  if (raw === undefined || raw === null || raw === '') return undefined
  const value = String(raw).trim().toLowerCase()
  const hiddenKey = row[`hide:${slot.alias}`] ?? row[`隐藏:${slot.alias}`]
  if (hiddenKey !== undefined && hiddenKey !== null && hiddenKey !== '') {
    return !['1', 'true', 'yes', 'y', '显示', '是'].includes(value)
  }
  return ['1', 'true', 'yes', 'y', '显示', '是'].includes(value)
}

function resolveTextForSlot(row: RowData, slot: SlotConfig) {
  const keys = [slot.alias, slot.name, slot.path, stripExtension(slot.alias)]
  const raw = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== '')
  return raw === undefined || raw === null ? undefined : String(raw)
}

function drawReplacement(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  left: number,
  top: number,
  width: number,
  height: number,
  mode: SlotMode,
) {
  if (!width || !height) return
  let sx = 0
  let sy = 0
  let sw = image.naturalWidth || image.width
  let sh = image.naturalHeight || image.height
  let dx = left
  let dy = top
  let dw = width
  let dh = height

  if (mode === 'fill') {
    const sourceRatio = sw / sh
    const targetRatio = width / height
    if (sourceRatio > targetRatio) {
      const nextWidth = sh * targetRatio
      sx = (sw - nextWidth) / 2
      sw = nextWidth
    } else {
      const nextHeight = sw / targetRatio
      sy = (sh - nextHeight) / 2
      sh = nextHeight
    }
  }

  if (mode === 'fit') {
    const scale = Math.min(width / sw, height / sh)
    dw = sw * scale
    dh = sh * scale
    dx = left + (width - dw) / 2
    dy = top + (height - dh) / 2
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, width, height)
  ctx.clip()
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
  ctx.restore()
}

function drawReplacementText(
  ctx: CanvasRenderingContext2D,
  text: string,
  left: number,
  top: number,
  width: number,
  height: number,
  slot: SlotConfig,
) {
  if (!width || !height) return
  const lines = text.split(/\r?\n/)
  const baseSize = slot.fontSize || defaultTextSize(height / Math.max(1, lines.length))
  const family = 'Avenir Next, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif'
  const weight = slot.weight || 850
  const maxWidth = width * 0.94
  const maxHeight = height * 0.92
  let fontSize = baseSize

  ctx.save()
  ctx.fillStyle = slot.color || '#ffffff'
  ctx.textAlign = slot.align || 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${weight} ${fontSize}px ${family}`

  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 1)
  if (widest > maxWidth) {
    fontSize = Math.max(10, Math.floor(fontSize * (maxWidth / widest)))
    ctx.font = `${weight} ${fontSize}px ${family}`
  }

  let lineHeight = fontSize * 1.12
  let totalHeight = lineHeight * lines.length
  if (totalHeight > maxHeight) {
    fontSize = Math.max(10, Math.floor(fontSize * (maxHeight / totalHeight)))
    ctx.font = `${weight} ${fontSize}px ${family}`
    lineHeight = fontSize * 1.12
    totalHeight = lineHeight * lines.length
  }

  ctx.beginPath()
  ctx.rect(left, top, width, height)
  ctx.clip()

  const anchorX = slot.align === 'left' ? left + width * 0.04 : slot.align === 'right' ? left + width * 0.96 : left + width / 2
  const firstY = top + height / 2 - totalHeight / 2 + lineHeight / 2

  lines.forEach((line, index) => {
    ctx.fillText(line, anchorX, firstY + index * lineHeight)
  })
  ctx.restore()
}

function renderPsd(
  psd: Psd,
  slots: SlotConfig[],
  row: RowData | undefined,
  images: ImageAsset[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = psd.width
  canvas.height = psd.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const slotMap = new Map(slots.map((slot) => [slot.id, slot]))
  const imageIndex = new Map<string, ImageAsset>()
  images.forEach((asset) => {
    imageIndex.set(asset.name.toLowerCase(), asset)
    imageIndex.set(asset.stem.toLowerCase(), asset)
  })

  const drawLayer = (layer: Layer, id: string) => {
    if (layer.hidden) return
    if (isGroup(layer)) {
      for (let i = layer.children.length - 1; i >= 0; i -= 1) {
        drawLayer(layer.children[i], `${id}.${i}`)
      }
      return
    }

    const original = layer.canvas
    if (!original) return
    const slot = slotMap.get(id)
    if (slot && row) {
      const visible = resolveVisibility(row, slot)
      if (visible === false) return
    }

    const { left, top, width, height } = layerBox(layer)
    ctx.save()
    ctx.globalAlpha = layer.opacity ?? 1
    ctx.globalCompositeOperation = blendModes[layer.blendMode || 'normal'] || 'source-over'

    const text = slot?.type === 'text' && row ? resolveTextForSlot(row, slot) : undefined
    const replacement = slot?.type === 'image' && row ? resolveImageForSlot(row, slot, images, imageIndex) : undefined
    if (slot?.type === 'text' && text !== undefined) {
      drawReplacementText(ctx, text, left, top, width, height, slot)
    } else if (replacement && slot) {
      drawReplacement(ctx, replacement.image, left, top, width, height, slot.mode)
    } else {
      ctx.drawImage(original, left, top)
    }
    ctx.restore()
  }

  if (psd.children?.length) {
    for (let i = psd.children.length - 1; i >= 0; i -= 1) {
      drawLayer(psd.children[i], `${i}`)
    }
  } else if (psd.canvas) {
    ctx.drawImage(psd.canvas, 0, 0)
  }

  return canvas
}

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('导出图片失败'))
    }, 'image/png')
  })

function App() {
  const [psd, setPsd] = useState<Psd | null>(null)
  const [psdName, setPsdName] = useState('')
  const [layers, setLayers] = useState<FlatLayer[]>([])
  const [slots, setSlots] = useState<SlotConfig[]>([])
  const [images, setImages] = useState<ImageAsset[]>([])
  const [rows, setRows] = useState<RowData[]>([])
  const [sheetName, setSheetName] = useState('')
  const [download, setDownload] = useState<DownloadState | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState('')
  const [status, setStatus] = useState('等待 PSD')
  const [busy, setBusy] = useState(false)
  const psdInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const sheetInputRef = useRef<HTMLInputElement>(null)

  const generatedRows = useMemo<RowData[]>(() => {
    if (rows.length) return rows
    if (!slots.length || !images.length) return []
    const primary = slots[0]
    return images.map((asset) => ({
      [primary.alias]: asset.name,
      __name: asset.stem,
    }))
  }, [images, rows, slots])

  const selectedIds = useMemo(() => new Set(slots.map((slot) => slot.id)), [slots])
  const slotAliases = useMemo(() => slots.map((slot) => slot.alias).join(' / '), [slots])
  const activeRow = generatedRows[previewIndex]

  useEffect(() => {
    if (!psd) {
      return
    }

    let revoked = ''
    window.requestAnimationFrame(() => {
      const canvas = renderPsd(psd, slots, activeRow, images)
      const url = canvas.toDataURL('image/png')
      revoked = url
      setPreviewUrl((previous) => {
        if (previous.startsWith('blob:')) URL.revokeObjectURL(previous)
        return url
      })
    })

    return () => {
      if (revoked.startsWith('blob:')) URL.revokeObjectURL(revoked)
    }
  }, [activeRow, images, psd, slots])

  useEffect(() => {
    return () => {
      images.forEach((asset) => URL.revokeObjectURL(asset.url))
    }
  }, [images])

  useEffect(() => {
    return () => {
      if (download) URL.revokeObjectURL(download.url)
    }
  }, [download])

  const handlePsd = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setStatus('读取 PSD')
    try {
      const buffer = await file.arrayBuffer()
      const nextPsd = readPsd(buffer, { skipThumbnail: true })
      const flat = flattenLayers(nextPsd.children)
      const defaults = pickDefaultSlots(flat)
      setPsd(nextPsd)
      setPsdName(file.name)
      setLayers(flat)
      setSlots(defaults)
      setRows([])
      setSheetName('')
      setDownload(null)
      setPreviewIndex(0)
      setStatus(`已识别 ${flat.length} 个图层`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'PSD 读取失败')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const loadDemo = () => {
    const nextPsd = makeDemoPsd()
    const flat = flattenLayers(nextPsd.children)
    setPsd(nextPsd)
    setPsdName('demo-template.psd')
    setLayers(flat)
    setSlots(buildDemoSlots(flat))
    setRows([])
    setSheetName('')
    setDownload(null)
    setPreviewIndex(0)
    setStatus(`样例 ${flat.length} 个图层`)
  }

  const loadTestBatch = async () => {
    setBusy(true)
    setStatus('生成测试数据')
    try {
      const nextPsd = makeDemoPsd()
      const flat = flattenLayers(nextPsd.children)
      const assets = await makeDemoProductFiles()
      setImages((previous) => {
        previous.forEach((asset) => URL.revokeObjectURL(asset.url))
        return assets
      })
      setPsd(nextPsd)
      setPsdName('demo-template.psd')
      setLayers(flat)
      setSlots(buildDemoSlots(flat))
      setRows([
        { 页面名称: '测试_A款_新人价', 商品图: 'product-a.png', 角标文案: '新人价', 价格: '¥129' },
        { 页面名称: '测试_B款_会员价', 商品图: 'product-b.png', 角标文案: '会员价', 价格: '¥159' },
        { 页面名称: '测试_横版_限时价', 商品图: 'product-c-wide.png', 角标文案: '限时价', 价格: '¥199' },
        { 页面名称: '测试_竖版_秒杀价', 商品图: 'product-d-tall.png', 角标文案: '秒杀价', 价格: '¥89' },
      ])
      setSheetName('demo-data.csv')
      setDownload(null)
      setPreviewIndex(0)
      setStatus('测试数据 4 行')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '测试数据生成失败')
    } finally {
      setBusy(false)
    }
  }

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'))
    if (!files.length) return
    setBusy(true)
    setStatus('读取图片')
    try {
      const assets = await Promise.all(files.map(imageFromFile))
      setImages((previous) => {
        previous.forEach((asset) => URL.revokeObjectURL(asset.url))
        return assets
      })
      setDownload(null)
      setPreviewIndex(0)
      setStatus(`已载入 ${assets.length} 张图片`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '图片读取失败')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const handleSheet = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setStatus('读取表格')
    try {
      const parsed = await parseRows(file)
      setRows(parsed)
      setSheetName(file.name)
      setDownload(null)
      setPreviewIndex(0)
      setStatus(`表格 ${parsed.length} 行`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '表格读取失败')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const toggleSlot = (item: FlatLayer) => {
    if (!hasCanvas(item.layer) || item.kind === 'group') return
    setSlots((previous) => {
      if (previous.some((slot) => slot.id === item.id)) {
        return previous.filter((slot) => slot.id !== item.id)
      }
      const used = new Set(previous.map((slot) => slot.alias.toLowerCase()))
      return [...previous, slotFromLayer(item, used)]
    })
  }

  const updateSlot = (id: string, patch: Partial<SlotConfig>) => {
    setSlots((previous) => previous.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)))
  }

  const resetSlots = () => setSlots(pickDefaultSlots(layers))

  const exportZip = async () => {
    if (!psd || !generatedRows.length) return
    setBusy(true)
    setStatus('生成图片')
    try {
      const zip = new JSZip()
      for (let index = 0; index < generatedRows.length; index += 1) {
        const row = generatedRows[index]
        const canvas = renderPsd(psd, slots, row, images)
        const blob = await canvasToBlob(canvas)
        zip.file(`${String(index + 1).padStart(3, '0')}_${getRowLabel(row, index)}.png`, blob)
        setStatus(`生成 ${index + 1}/${generatedRows.length}`)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const name = `${safeName(stripExtension(psdName || 'psd-batch'))}_批量出图.zip`
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setDownload({ url, name, size: blob.size })
      setStatus(`已导出 ${generatedRows.length} 张`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="workspace">
      <input ref={psdInputRef} className="hidden-input" type="file" accept=".psd" onChange={handlePsd} />
      <input
        ref={imageInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={handleImages}
      />
      <input
        ref={sheetInputRef}
        className="hidden-input"
        type="file"
        accept=".csv,.xlsx"
        onChange={handleSheet}
      />

      <aside className="panel">
        <header className="brand">
          <div className="brand-mark">
            <Wand2 size={22} />
          </div>
          <div>
            <p>PSD 批量换图</p>
            <span>本地原型</span>
          </div>
        </header>

        <section className="drop-zone" onClick={() => psdInputRef.current?.click()}>
          <Upload size={24} />
          <div>
            <strong>{psdName || '上传 PSD'}</strong>
            <span>{psd ? `${psd.width} x ${psd.height}px` : 'Photoshop 模板'}</span>
          </div>
        </section>

        <div className="action-grid">
          <button type="button" onClick={loadDemo} disabled={busy}>
            <FileImage size={18} />
            样例
          </button>
          <button type="button" onClick={loadTestBatch} disabled={busy}>
            <FlaskConical size={18} />
            测试
          </button>
          <button type="button" onClick={() => imageInputRef.current?.click()} disabled={!psd || busy}>
            <ImagePlus size={18} />
            批量图片
          </button>
          <button type="button" onClick={() => sheetInputRef.current?.click()} disabled={!psd || busy}>
            <FileSpreadsheet size={18} />
            数据表
          </button>
        </div>

        <section className="metric-row">
          <div>
            <strong>{layers.length}</strong>
            <span>图层</span>
          </div>
          <div>
            <strong>{slots.length}</strong>
            <span>槽位</span>
          </div>
          <div>
            <strong>{generatedRows.length}</strong>
            <span>成品</span>
          </div>
        </section>

        <section className="stack">
          <div className="section-title">
            <Layers size={18} />
            <span>替换槽位</span>
            <button type="button" className="icon-button" onClick={resetSlots} disabled={!layers.length} title="重选建议槽位">
              <RefreshCcw size={16} />
            </button>
          </div>

          <div className="slot-list">
            {slots.length ? (
              slots.map((slot) => (
                <div className="slot-card" key={slot.id}>
                  <div>
                    <strong>{slot.name}</strong>
                    <span>{slot.path}</span>
                  </div>
                  <div className={`slot-controls ${slot.type === 'text' ? 'text-slot-controls' : ''}`}>
                    <input value={slot.alias} onChange={(event) => updateSlot(slot.id, { alias: event.target.value })} />
                    <select
                      value={slot.type}
                      onChange={(event) => {
                        const type = event.target.value as SlotType
                        updateSlot(slot.id, {
                          type,
                          fontSize: type === 'text' ? (slot.fontSize ?? 32) : slot.fontSize,
                          color: type === 'text' ? (slot.color ?? '#ffffff') : slot.color,
                          align: type === 'text' ? (slot.align ?? 'center') : slot.align,
                          weight: type === 'text' ? (slot.weight ?? 850) : slot.weight,
                        })
                      }}
                    >
                      {Object.entries(slotTypeLabels).map(([type, label]) => (
                        <option key={type} value={type}>
                          {label}
                        </option>
                      ))}
                    </select>
                    {slot.type === 'text' ? (
                      <>
                        <input
                          className="number-input"
                          type="number"
                          min={10}
                          max={180}
                          value={slot.fontSize ?? 32}
                          title="字号"
                          onChange={(event) =>
                            updateSlot(slot.id, { fontSize: Math.max(10, Number(event.target.value) || 32) })
                          }
                        />
                        <input
                          className="color-input"
                          type="color"
                          value={slot.color ?? '#ffffff'}
                          title="文字颜色"
                          onChange={(event) => updateSlot(slot.id, { color: event.target.value })}
                        />
                      </>
                    ) : (
                      <select value={slot.mode} onChange={(event) => updateSlot(slot.id, { mode: event.target.value as SlotMode })}>
                        {Object.entries(modeLabels).map(([mode, label]) => (
                          <option key={mode} value={mode}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">未选择</div>
            )}
          </div>
        </section>

        <section className="stack layer-browser">
          <div className="section-title">
            <MousePointer2 size={18} />
            <span>PSD 图层</span>
          </div>
          <div className="layer-list">
            {layers.length ? (
              layers.map((item) => (
                <button
                  type="button"
                  className={`layer-row ${selectedIds.has(item.id) ? 'selected' : ''}`}
                  key={item.id}
                  style={{ paddingLeft: `${12 + item.depth * 14}px` }}
                  onClick={() => toggleSlot(item)}
                  disabled={item.kind === 'group' || !hasCanvas(item.layer)}
                >
                  <span>{selectedIds.has(item.id) && <Check size={14} />}</span>
                  <strong>{item.name}</strong>
                  <em>{item.kind === 'group' ? '组' : `${item.width} x ${item.height}`}</em>
                </button>
              ))
            ) : (
              <div className="empty">等待导入</div>
            )}
          </div>
        </section>
      </aside>

      <section className="preview-shell">
        <header className="topbar">
          <div>
            <h1>批量出图工作台</h1>
            <p>{slotAliases || '导入 PSD 后选择可替换图层'}</p>
          </div>
          <div className="status-pill">
            {busy ? <Loader2 className="spin" size={16} /> : <Archive size={16} />}
            <span>{status}</span>
          </div>
        </header>

        <div className="preview-stage">
          {previewUrl ? (
            <img src={previewUrl} alt="PSD preview" />
          ) : (
            <div className="preview-empty">
              <FileImage size={42} />
              <span>PSD 预览</span>
            </div>
          )}
        </div>

        <footer className="footerbar">
          <div className="batch-info">
            <strong>{activeRow ? getRowLabel(activeRow, previewIndex) : sheetName || '未生成'}</strong>
            <span>{images.length ? `${images.length} 张图片` : '图片库为空'}</span>
          </div>
          <div className="pager">
            <button
              type="button"
              className="icon-button"
              onClick={() => setPreviewIndex((value) => Math.max(0, value - 1))}
              disabled={!generatedRows.length || previewIndex === 0}
              title="上一张"
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {generatedRows.length ? previewIndex + 1 : 0} / {generatedRows.length}
            </span>
            <button
              type="button"
              className="icon-button"
              onClick={() => setPreviewIndex((value) => Math.min(generatedRows.length - 1, value + 1))}
              disabled={!generatedRows.length || previewIndex >= generatedRows.length - 1}
              title="下一张"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {download && (
            <a className="download-link" href={download.url} download={download.name}>
              <Archive size={16} />
              {Math.max(1, Math.round(download.size / 1024))} KB
            </a>
          )}
          <button className="export-button" type="button" onClick={exportZip} disabled={!generatedRows.length || busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
            导出 PNG 包
          </button>
        </footer>
      </section>
    </main>
  )
}

export default App
