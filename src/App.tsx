import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  Archive,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileImage,
  FileSpreadsheet,
  FolderOpen,
  FlaskConical,
  ImagePlus,
  Layers,
  Loader2,
  MousePointer2,
  RefreshCcw,
  Save,
  Type,
  Upload,
  Wand2,
} from 'lucide-react'
import JSZip from 'jszip'
import { readSheet } from 'read-excel-file/browser'
import { readPsd, type Layer, type Psd } from 'ag-psd'
import './App.css'

type SlotMode = 'fill' | 'fit' | 'stretch'
type SlotMask = 'rect' | 'round' | 'circle'
type SlotType = 'image' | 'text'
type LayerKind = 'group' | 'image' | 'text'
type RenderMode = 'layers' | 'composite'

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
  mask?: SlotMask
  fontSize?: number
  color?: string
  align?: CanvasTextAlign
  weight?: number
  fontFamily?: string
  left?: number
  top?: number
  width?: number
  height?: number
}

type ImageAsset = {
  file: File
  name: string
  stem: string
  url: string
  image: HTMLImageElement
}

type RowData = Record<string, string | number | boolean | null | undefined>

type FontAsset = {
  file: File
  name: string
  stem: string
  family: string
  url: string
}

type DownloadState = {
  url: string
  name: string
  size: number
}

type ValidationIssue = {
  rowIndex: number
  alias: string
  message: string
  severity: 'warning' | 'error'
}

type GuideBox = {
  id: string
  name: string
  alias: string
  type: SlotType
  left: number
  top: number
  width: number
  height: number
}

type GalleryItem = {
  url: string
  label: string
  index: number
}

const directSlotIdKey = '__directSlotId'
const directKindKey = '__directKind'

const modeLabels: Record<SlotMode, string> = {
  fill: '铺满',
  fit: '完整',
  stretch: '拉伸',
}

const maskLabels: Record<SlotMask, string> = {
  rect: '矩形',
  round: '圆角',
  circle: '圆形',
}

const slotTypeLabels: Record<SlotType, string> = {
  image: '图片',
  text: '文字',
}

const defaultTextFamily = 'Avenir Next, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif'

const builtInFonts = [
  { label: '默认', value: '' },
  { label: '苹方', value: 'PingFang SC, Microsoft YaHei, sans-serif' },
  { label: '宋体', value: 'Songti SC, SimSun, serif' },
  { label: '楷体', value: 'Kaiti SC, KaiTi, serif' },
  { label: 'Avenir', value: 'Avenir Next, PingFang SC, sans-serif' },
]

const storagePrefix = 'psd-batch-tool:slots:'

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

const configKeyForTemplate = (name: string, psd: Pick<Psd, 'width' | 'height'>) =>
  `${storagePrefix}${safeName(stripExtension(name || 'untitled'))}:${psd.width}x${psd.height}`

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

const fontFromFile = async (file: File): Promise<FontAsset> => {
  const url = URL.createObjectURL(file)
  const stem = stripExtension(file.name)
  const family = `Uploaded_${safeName(stem).replace(/[^\w-]/g, '_')}_${Math.random().toString(36).slice(2, 7)}`

  try {
    const font = new FontFace(family, `url(${url})`)
    await font.load()
    document.fonts.add(font)
    return { file, name: file.name, stem, family, url }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error instanceof Error ? error : new Error(`字体无法读取：${file.name}`)
  }
}

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

const layerRasterCache = new WeakMap<Layer, HTMLCanvasElement>()

const rasterCanvasForLayer = (layer: Layer) => {
  if (layer.canvas) return layer.canvas
  if (!layer.imageData) return undefined
  const cached = layerRasterCache.get(layer)
  if (cached) return cached
  const { width, height, data } = layer.imageData
  if (!width || !height || data.length < width * height * 4) return undefined

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined

  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < rgba.length; index += 1) {
    rgba[index] = Number(data[index] ?? 0)
  }
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0)
  layerRasterCache.set(layer, canvas)
  return canvas
}

const hasPixels = (layer: Layer) => Boolean(layer.canvas || layer.imageData)

const isGroup = (layer: Layer): layer is Layer & { children: Layer[] } => Array.isArray(layer.children)

const isText = (layer: Layer) => 'text' in layer

const layerBox = (layer: Layer) => {
  const left = layer.left ?? 0
  const top = layer.top ?? 0
  const fallbackWidth = layer.canvas?.width ?? layer.imageData?.width ?? 0
  const fallbackHeight = layer.canvas?.height ?? layer.imageData?.height ?? 0
  const width = Math.max(0, (layer.right ?? left + fallbackWidth) - left)
  const height = Math.max(0, (layer.bottom ?? top + fallbackHeight) - top)
  return { left, top, width, height }
}

const slotBox = (layer: Layer, slot?: SlotConfig) => {
  const original = layerBox(layer)
  return {
    left: slot?.left ?? original.left,
    top: slot?.top ?? original.top,
    width: slot?.width ?? original.width,
    height: slot?.height ?? original.height,
  }
}

const hasUsableBox = (item: Pick<FlatLayer, 'kind' | 'width' | 'height'>) =>
  item.kind !== 'group' && item.width > 4 && item.height > 4

const canUseAsSlot = (item: FlatLayer) => hasUsableBox(item)

const needsCompositePreview = (psd: Psd | null, layers: FlatLayer[]) => {
  if (!psd?.canvas || !layers.length) return false
  const leaves = layers.filter((item) => hasUsableBox(item) && !item.hidden)
  if (!leaves.length) return false
  const drawable = leaves.filter((item) => hasPixels(item.layer)).length
  return drawable / leaves.length < 0.72
}

const inferSlotType = (item: Pick<FlatLayer, 'kind' | 'name'>): SlotType => {
  if (item.kind === 'text') return 'text'
  return /(文字|文案|标题|价格|姓名|名字|名称|标签|价|name|text|title|price|label)/i.test(item.name)
    ? 'text'
    : 'image'
}

const defaultTextSize = (height: number) => Math.max(14, Math.min(96, Math.round(height * 0.72)))

const isReplacementLayer = (item: Pick<FlatLayer, 'name'>) =>
  /(_?替换$|换图|可变|变量|replace|variable)/i.test(item.name)

const inferSlotMode = (item: Pick<FlatLayer, 'name'>): SlotMode =>
  /(logo|标志|商标|二维码|qrcode|qr)/i.test(item.name) ? 'fit' : 'fill'

const inferSlotMask = (item: Pick<FlatLayer, 'name'>): SlotMask => {
  if (/(头像|人像|headshot|avatar|portrait)/i.test(item.name)) return 'circle'
  if (/(logo|标志|商标|icon|图标)/i.test(item.name)) return 'round'
  return 'rect'
}

const directTextSize = (width: number, height: number) => {
  const shortEdge = Math.max(1, Math.min(width, height))
  return Math.max(36, Math.min(180, Math.round(shortEdge * 0.22)))
}

const textStrokeFor = (color?: string) => {
  const raw = String(color || '').trim()
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return 'rgba(28, 46, 48, 0.72)'
  const hex = match[1].length === 3 ? match[1].replace(/./g, (item) => item + item) : match[1]
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.56 ? 'rgba(28, 46, 48, 0.72)' : 'rgba(255, 250, 240, 0.9)'
}

const getLayerById = (psd: Psd, id: string) => {
  const parts = id
    .split('.')
    .map((part) => Number(part))
    .filter((part) => Number.isInteger(part) && part >= 0)
  let children = psd.children
  let current: Layer | undefined

  for (const part of parts) {
    current = children?.[part]
    if (!current) return undefined
    children = isGroup(current) ? current.children : undefined
  }

  return current
}

const averageLayerLuminance = (layer?: Layer) => {
  if (!layer) return undefined
  const source = rasterCanvasForLayer(layer)
  if (!source) return undefined
  const width = Math.max(1, Math.min(32, source.width))
  const height = Math.max(1, Math.min(32, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return undefined

  try {
    ctx.drawImage(source, 0, 0, width, height)
    const data = ctx.getImageData(0, 0, width, height).data
    let total = 0
    let count = 0
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255
      if (alpha < 0.08) continue
      total += ((0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]) / 255) * alpha
      count += alpha
    }
    return count ? total / count : undefined
  } catch {
    return undefined
  }
}

const readableTextColorForLayer = (layer?: Layer) => {
  const luminance = averageLayerLuminance(layer)
  return luminance !== undefined && luminance < 0.46 ? '#ffffff' : '#233f40'
}

const slotFromLayer = (item: FlatLayer, used: Set<string>): SlotConfig => {
  const type = inferSlotType(item)
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    alias: toAlias(item.name.replace(/(_?替换$|换图|可变|变量|replace|variable)/gi, ''), used),
    type,
    mode: inferSlotMode(item),
    mask: type === 'image' ? inferSlotMask(item) : undefined,
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
  const usable = layers.filter((item) => canUseAsSlot(item) && !item.hidden && item.width > 12 && item.height > 12)
  const replacement = usable.filter(isReplacementLayer)
  const preferred = usable.filter((item) => !/(背景|底图|background|bg|backdrop)/i.test(item.name))
  const replacementIds = new Set(replacement.map((item) => item.id))
  const source = preferred.length
    ? [...replacement, ...preferred.filter((item) => !replacementIds.has(item.id))]
    : usable

  return source
    .filter((item) => canUseAsSlot(item) && !item.hidden && item.width > 12 && item.height > 12)
    .sort((a, b) => {
      const aBoost = /(商品|产品|主图|图片|换图|替换|image|photo|product|replace)/i.test(a.name) ? 10_000_000 : 0
      const bBoost = /(商品|产品|主图|图片|换图|替换|image|photo|product|replace)/i.test(b.name) ? 10_000_000 : 0
      return b.width * b.height + bBoost - (a.width * a.height + aBoost)
    })
    .slice(0, 40)
    .map<SlotConfig>((item) => slotFromLayer(item, used))
}

const mergeSlotConfigs = (defaults: SlotConfig[], saved?: SlotConfig[]) => {
  if (!saved?.length) return defaults
  const usedIds = new Set(saved.map((slot) => slot.id))
  const usedAliases = new Set(saved.map((slot) => slot.alias.toLowerCase()))
  const missing = defaults
    .filter((slot) => !usedIds.has(slot.id))
    .map((slot) => ({ ...slot, alias: toAlias(slot.alias, usedAliases) }))
  return [...saved, ...missing]
}

const buildDemoSlots = (layers: FlatLayer[]) => {
  const productSlot = layers.find((item) => item.name === '商品图_替换')
  const logoSlot = layers.find((item) => item.name === 'Logo_替换')
  const nameSlot = layers.find((item) => item.name === '姓名_替换')
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
      mask: 'rect',
    })
  }

  if (logoSlot) {
    slots.push({
      id: logoSlot.id,
      name: logoSlot.name,
      path: logoSlot.path,
      alias: 'Logo',
      type: 'image',
      mode: 'fit',
      mask: 'round',
    })
  }

  if (nameSlot) {
    slots.push({
      id: nameSlot.id,
      name: nameSlot.name,
      path: nameSlot.path,
      alias: '姓名',
      type: 'text',
      mode: 'fill',
      color: '#233f40',
      align: 'left',
      weight: 850,
      fontSize: 38,
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

  const attendeeName = createCanvas(360, 56, (ctx) => {
    ctx.fillStyle = '#233f40'
    ctx.font = '850 42px Avenir Next, PingFang SC, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('参会姓名', 0, 30)
  })

  const logoSlot = createCanvas(140, 52, (ctx) => {
    ctx.fillStyle = '#f9f7ef'
    ctx.beginPath()
    ctx.roundRect(0, 0, 140, 52, 10)
    ctx.fill()
    ctx.fillStyle = '#233f40'
    ctx.font = '800 22px Avenir Next, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('LOGO', 70, 27)
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
      { name: 'Logo_替换', top: 34, left: 690, bottom: 86, right: 830, canvas: logoSlot },
      { name: '价格_替换', top: 886, left: 634, bottom: 944, right: 784, canvas: priceValue, text: { text: '¥199' } },
      { name: '角标文案_替换', top: 842, left: 652, bottom: 876, right: 764, canvas: priceLabel, text: { text: '限时价' } },
      { name: '黄色价格底框', top: 828, left: 594, bottom: 960, right: 824, canvas: priceBadge },
      { name: '姓名_替换', top: 286, left: 72, bottom: 326, right: 432, canvas: attendeeName, text: { text: '参会姓名' } },
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
    { name: 'product-a.png', hue: '#2f6f73', accent: '#d7a23d', label: 'A款', kind: 'product' },
    { name: 'product-b.png', hue: '#8f4e45', accent: '#233f40', label: 'B款', kind: 'product' },
    { name: 'product-c-wide.png', hue: '#435f8a', accent: '#ead9b8', label: '横版', kind: 'product' },
    { name: 'product-d-tall.png', hue: '#5d7656', accent: '#1f3a31', label: '竖版', kind: 'product' },
    { name: 'logo-a.png', hue: '#233f40', accent: '#d7a23d', label: 'DONT', kind: 'logo' },
    { name: 'logo-b.png', hue: '#8f4e45', accent: '#f9f7ef', label: 'FLOW', kind: 'logo' },
    { name: 'logo-c.png', hue: '#435f8a', accent: '#f9f7ef', label: 'NOVA', kind: 'logo' },
    { name: 'logo-d.png', hue: '#5d7656', accent: '#f9f7ef', label: 'MUSE', kind: 'logo' },
  ]

  const files = await Promise.all(
    specs.map((spec, index) => {
      const logo = spec.kind === 'logo'
      const wide = spec.name.includes('wide')
      const tall = spec.name.includes('tall')
      const width = logo ? 420 : wide ? 900 : tall ? 420 : 700
      const height = logo ? 156 : wide ? 500 : tall ? 900 : 700
      const canvas = createCanvas(width, height, (ctx) => {
        ctx.fillStyle = '#fbfaf2'
        ctx.fillRect(0, 0, width, height)
        if (logo) {
          ctx.fillStyle = spec.hue
          ctx.beginPath()
          ctx.roundRect(18, 18, width - 36, height - 36, 24)
          ctx.fill()
          ctx.fillStyle = spec.accent
          ctx.beginPath()
          ctx.arc(72, height / 2, 28, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#ffffff'
          ctx.font = '900 44px Avenir Next, sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(spec.label, width / 2 + 44, height / 2 + 2)
          return
        }
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

function buildFontIndex(fonts: FontAsset[]) {
  const fontIndex = new Map<string, string>()
  fonts.forEach((asset) => {
    fontIndex.set(asset.name.toLowerCase(), asset.family)
    fontIndex.set(asset.stem.toLowerCase(), asset.family)
    fontIndex.set(asset.family.toLowerCase(), asset.family)
  })
  return fontIndex
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

function resolveRawForSlot(row: RowData, slot: SlotConfig) {
  const keys = [slot.alias, slot.name, slot.path, stripExtension(slot.alias)]
  const raw = keys.map((key) => row[key]).find((item) => item !== undefined && item !== null && String(item).trim() !== '')
  return raw === undefined || raw === null ? undefined : raw
}

function resolveTextForSlot(row: RowData, slot: SlotConfig) {
  const raw = resolveRawForSlot(row, slot)
  return raw === undefined || raw === null ? undefined : String(raw)
}

function resolveFontForSlot(row: RowData, slot: SlotConfig, fontIndex: Map<string, string>) {
  const raw =
    row[`字体:${slot.alias}`] ??
    row[`${slot.alias}:字体`] ??
    row[`font:${slot.alias}`] ??
    row[`${slot.alias}:font`] ??
    row['字体'] ??
    row['font']

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return slot.fontFamily
  }

  const value = String(raw).trim()
  const normalized = normalizeKey(value)
  return fontIndex.get(value.toLowerCase()) || fontIndex.get(normalized) || fontIndex.get(stripExtension(normalized)) || value
}

function clipSlot(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  mask: SlotMask = 'rect',
) {
  ctx.beginPath()
  if (mask === 'circle') {
    const radius = Math.min(width, height) / 2
    ctx.arc(left + width / 2, top + height / 2, radius, 0, Math.PI * 2)
    ctx.clip()
    return
  }
  if (mask === 'round') {
    ctx.roundRect(left, top, width, height, Math.min(width, height) * 0.16)
    ctx.clip()
    return
  }
  ctx.rect(left, top, width, height)
  ctx.clip()
}

function drawReplacement(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  left: number,
  top: number,
  width: number,
  height: number,
  mode: SlotMode,
  mask: SlotMask = 'rect',
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
  clipSlot(ctx, left, top, width, height, mask)
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
  const family = slot.fontFamily || defaultTextFamily
  const weight = slot.weight || 850
  const maxWidth = width * 0.94
  const maxHeight = height * 0.92
  let fontSize = baseSize

  ctx.save()
  const fillColor = slot.color || '#ffffff'
  ctx.fillStyle = fillColor
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
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.strokeStyle = textStrokeFor(fillColor)
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.08))

  lines.forEach((line, index) => {
    const y = firstY + index * lineHeight
    ctx.strokeText(line, anchorX, y)
    ctx.fillText(line, anchorX, y)
  })
  ctx.restore()
}

function renderPsd(
  psd: Psd,
  slots: SlotConfig[],
  row: RowData | undefined,
  images: ImageAsset[],
  fonts: FontAsset[],
  mode: RenderMode,
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
  const fontIndex = buildFontIndex(fonts)
  const directSlotId = row ? String(row[directSlotIdKey] ?? '') : ''
  const directKind = row ? String(row[directKindKey] ?? '') : ''

  const drawFinalDirectReplacement = () => {
    if (!row || !directSlotId) return
    const baseSlot = slotMap.get(directSlotId)
    const layer = getLayerById(psd, directSlotId)
    if (!baseSlot || !layer) return

    const slot: SlotConfig =
      directKind === 'text'
        ? { ...baseSlot, type: 'text' }
        : directKind === 'image'
          ? { ...baseSlot, type: 'image' }
          : baseSlot
    if (resolveVisibility(row, slot) === false) return

    const { left, top, width, height } = slotBox(layer, slot)
    const slotColor = slot.color?.toLowerCase()
    const fallbackColor =
      directKind === 'text' && (!slot.color || slotColor === '#ffffff')
        ? readableTextColorForLayer(layer)
        : slot.color
    const drawSlot: SlotConfig =
      slot.type === 'text'
        ? {
            ...slot,
            fontSize: slot.fontSize ?? directTextSize(width, height),
            color: fallbackColor ?? '#ffffff',
            align: slot.align ?? 'center',
            weight: slot.weight ?? 900,
          }
        : slot
    const text = drawSlot.type === 'text' ? resolveTextForSlot(row, drawSlot) : undefined
    const replacement = drawSlot.type === 'image' ? resolveImageForSlot(row, drawSlot, images, imageIndex) : undefined

    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    if (drawSlot.type === 'text' && text !== undefined) {
      drawReplacementText(ctx, text, left, top, width, height, {
        ...drawSlot,
        fontFamily: resolveFontForSlot(row, drawSlot, fontIndex),
      })
    } else if (replacement) {
      drawReplacement(ctx, replacement.image, left, top, width, height, drawSlot.mode, drawSlot.mask)
    }
    ctx.restore()
  }

  if (mode === 'composite' && psd.canvas) {
    ctx.drawImage(psd.canvas, 0, 0)
    if (!row) return canvas

    const drawSlotReplacement = (layer: Layer, id: string) => {
      const slot = slotMap.get(id)
      if (!slot) return
      if (id === directSlotId) return
      const visible = resolveVisibility(row, slot)
      if (visible === false) return

      const { left, top, width, height } = slotBox(layer, slot)
      const text = slot.type === 'text' ? resolveTextForSlot(row, slot) : undefined
      const replacement = slot.type === 'image' ? resolveImageForSlot(row, slot, images, imageIndex) : undefined

      if (slot.type === 'text' && text !== undefined) {
        drawReplacementText(ctx, text, left, top, width, height, {
          ...slot,
          fontFamily: resolveFontForSlot(row, slot, fontIndex),
        })
      } else if (replacement) {
        drawReplacement(ctx, replacement.image, left, top, width, height, slot.mode, slot.mask)
      }
    }

    const visitLayer = (layer: Layer, id: string) => {
      if (layer.hidden) return
      if (isGroup(layer)) {
        layer.children.forEach((child, index) => visitLayer(child, `${id}.${index}`))
        return
      }
      drawSlotReplacement(layer, id)
    }

    psd.children?.forEach((layer, index) => visitLayer(layer, `${index}`))
    drawFinalDirectReplacement()
    return canvas
  }

  const drawLayer = (layer: Layer, id: string) => {
    if (layer.hidden) return
    if (isGroup(layer)) {
      for (let i = layer.children.length - 1; i >= 0; i -= 1) {
        drawLayer(layer.children[i], `${id}.${i}`)
      }
      return
    }

    const slot = slotMap.get(id)
    if (slot && row) {
      const visible = resolveVisibility(row, slot)
      if (visible === false) return
      if (slot.id === directSlotId) return
    }

    const { left, top, width, height } = slotBox(layer, slot)
    ctx.save()
    ctx.globalAlpha = layer.opacity ?? 1
    ctx.globalCompositeOperation = blendModes[layer.blendMode || 'normal'] || 'source-over'

    const text = slot?.type === 'text' && row ? resolveTextForSlot(row, slot) : undefined
    const replacement = slot?.type === 'image' && row ? resolveImageForSlot(row, slot, images, imageIndex) : undefined
    if (slot?.type === 'text' && text !== undefined) {
      drawReplacementText(ctx, text, left, top, width, height, {
        ...slot,
        fontFamily: row ? resolveFontForSlot(row, slot, fontIndex) : slot.fontFamily,
      })
    } else if (replacement && slot) {
      drawReplacement(ctx, replacement.image, left, top, width, height, slot.mode, slot.mask)
    } else {
      const original = rasterCanvasForLayer(layer)
      if (!original) {
        ctx.restore()
        return
      }
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

  drawFinalDirectReplacement()
  return canvas
}

const canvasToBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('导出图片失败'))
    }, 'image/png')
  })

const parseElementList = (value: string) =>
  value
    .split(/\r?\n|[,，]/)
    .map((item) => item.trim())
    .filter(Boolean)

function validateRows(rows: RowData[], slots: SlotConfig[], images: ImageAsset[]) {
  if (!rows.length || !slots.length) return []
  const imageIndex = new Map<string, ImageAsset>()
  images.forEach((asset) => {
    imageIndex.set(asset.name.toLowerCase(), asset)
    imageIndex.set(asset.stem.toLowerCase(), asset)
  })

  const issues: ValidationIssue[] = []
  rows.forEach((row, rowIndex) => {
    slots.forEach((slot) => {
      if (slot.type === 'text') {
        return
      }

      const raw = [slot.alias, slot.name, slot.path, stripExtension(slot.alias)]
        .map((key) => row[key])
        .find((item) => String(item ?? '').trim())
      if (!raw) return

      const normalized = normalizeKey(raw)
      const stem = stripExtension(normalized)
      if (!imageIndex.has(normalized) && !imageIndex.has(stem)) {
        issues.push({
          rowIndex,
          alias: slot.alias,
          severity: 'error',
          message: `第 ${rowIndex + 1} 行找不到图片「${String(raw)}」`,
        })
      }
    })
  })
  return issues
}

function App() {
  const [psd, setPsd] = useState<Psd | null>(null)
  const [psdName, setPsdName] = useState('')
  const [layers, setLayers] = useState<FlatLayer[]>([])
  const [slots, setSlots] = useState<SlotConfig[]>([])
  const [images, setImages] = useState<ImageAsset[]>([])
  const [fonts, setFonts] = useState<FontAsset[]>([])
  const [rows, setRows] = useState<RowData[]>([])
  const [sheetName, setSheetName] = useState('')
  const [download, setDownload] = useState<DownloadState | null>(null)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewUrl, setPreviewUrl] = useState('')
  const [gallery, setGallery] = useState<GalleryItem[]>([])
  const [elementText, setElementText] = useState('')
  const [status, setStatus] = useState('等待 PSD')
  const [activeSlotId, setActiveSlotId] = useState('')
  const [showGuides, setShowGuides] = useState(true)
  const [forceLayerRender, setForceLayerRender] = useState(false)
  const [busy, setBusy] = useState(false)
  const psdInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const sheetInputRef = useRef<HTMLInputElement>(null)
  const fontInputRef = useRef<HTMLInputElement>(null)

  const generatedRows = useMemo<RowData[]>(() => {
    if (rows.length) return rows
    if (!slots.length || !images.length) return []
    const selected = slots.find((slot) => slot.id === activeSlotId && slot.type === 'image')
    const primary = selected || slots.find((slot) => slot.type === 'image') || slots[0]
    return images.map((asset) => ({
      [primary.alias]: asset.name,
      __name: asset.stem,
    }))
  }, [activeSlotId, images, rows, slots])

  const selectedIds = useMemo(() => new Set(slots.map((slot) => slot.id)), [slots])
  const slotAliases = useMemo(() => slots.map((slot) => slot.alias).join(' / '), [slots])
  const layerById = useMemo(() => new Map(layers.map((item) => [item.id, item])), [layers])
  const renderMode: RenderMode = psd && !forceLayerRender && needsCompositePreview(psd, layers) ? 'composite' : 'layers'
  const guideBoxes = useMemo<GuideBox[]>(() => {
    return slots
      .map((slot) => {
        const item = layerById.get(slot.id)
        if (!item) return undefined
        const { left, top, width, height } = slotBox(item.layer, slot)
        return { id: slot.id, name: slot.name, alias: slot.alias, type: slot.type, left, top, width, height }
      })
      .filter((item): item is GuideBox => Boolean(item && item.width > 0 && item.height > 0))
  }, [layerById, slots])
  const validationIssues = useMemo(() => validateRows(generatedRows, slots, images), [generatedRows, images, slots])
  const errorCount = validationIssues.filter((issue) => issue.severity === 'error').length
  const fontOptions = useMemo(
    () => [...builtInFonts, ...fonts.map((font) => ({ label: stripExtension(font.name), value: font.family }))],
    [fonts],
  )
  const activeSlot = useMemo(
    () => slots.find((slot) => slot.id === activeSlotId) || slots[0],
    [activeSlotId, slots],
  )
  const elementCount = useMemo(() => parseElementList(elementText).length, [elementText])
  const activeRow = generatedRows[previewIndex]
  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots])
  const guideLabels = useMemo(() => {
    const labels = new Map<string, string>()
    guideBoxes.forEach((box) => {
      const slot = slotById.get(box.id)
      const raw = activeRow && slot ? resolveRawForSlot(activeRow, slot) : undefined
      const value = raw === undefined || raw === null ? '' : String(raw).trim()
      labels.set(box.id, value ? `${box.alias}: ${value}` : box.alias)
    })
    return labels
  }, [activeRow, guideBoxes, slotById])

  useEffect(() => {
    if (!psd) {
      return
    }

    let revoked = ''
    window.requestAnimationFrame(() => {
      const canvas = renderPsd(psd, slots, activeRow, images, fonts, renderMode)
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
  }, [activeRow, fonts, images, psd, renderMode, slots])

  useEffect(() => {
    return () => {
      images.forEach((asset) => URL.revokeObjectURL(asset.url))
    }
  }, [images])

  useEffect(() => {
    return () => {
      fonts.forEach((asset) => URL.revokeObjectURL(asset.url))
    }
  }, [fonts])

  useEffect(() => {
    return () => {
      if (download) URL.revokeObjectURL(download.url)
    }
  }, [download])

  useEffect(() => {
    let cancelled = false
    if (!psd || !generatedRows.length) {
      window.requestAnimationFrame(() => {
        if (!cancelled) setGallery([])
      })
      return
    }

    window.requestAnimationFrame(() => {
      const items = generatedRows.map((row, index) => {
        const canvas = renderPsd(psd, slots, row, images, fonts, renderMode)
        return {
          url: canvas.toDataURL('image/png'),
          label: getRowLabel(row, index),
          index,
        }
      })
      if (!cancelled) setGallery(items)
    })

    return () => {
      cancelled = true
    }
  }, [fonts, generatedRows, images, psd, renderMode, slots])

  const readSavedSlots = (name: string, template: Psd, flat: FlatLayer[]) => {
    try {
      const raw = window.localStorage.getItem(configKeyForTemplate(name, template))
      if (!raw) return undefined
      const parsed = JSON.parse(raw) as { slots?: SlotConfig[] }
      const ids = new Set(flat.map((item) => item.id))
      const saved = (parsed.slots || []).filter((slot) => ids.has(slot.id))
      return saved.length ? saved : undefined
    } catch {
      return undefined
    }
  }

  const saveTemplateConfig = () => {
    if (!psd || !slots.length) return
    window.localStorage.setItem(configKeyForTemplate(psdName, psd), JSON.stringify({ slots }))
    setStatus(`已保存 ${slots.length} 个槽位配置`)
  }

  const loadTemplateConfig = () => {
    if (!psd) return
    const saved = readSavedSlots(psdName, psd, layers)
    if (!saved) {
      setStatus('没有找到当前 PSD 的配置')
      return
    }
    const merged = mergeSlotConfigs(pickDefaultSlots(layers), saved)
    setSlots(merged)
    setActiveSlotId(merged[0]?.id || '')
    setStatus(`已载入 ${saved.length} 个配置，并补齐到 ${merged.length} 个可替换图层`)
  }

  const handlePsd = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setStatus('读取 PSD')
    try {
      const buffer = await file.arrayBuffer()
      const nextPsd = readPsd(buffer, { skipThumbnail: true })
      const flat = flattenLayers(nextPsd.children)
      const saved = readSavedSlots(file.name, nextPsd, flat)
      const defaults = mergeSlotConfigs(pickDefaultSlots(flat), saved)
      setPsd(nextPsd)
      setPsdName(file.name)
      setLayers(flat)
      setSlots(defaults)
      setRows([])
      setSheetName('')
      setDownload(null)
      setPreviewIndex(0)
      setActiveSlotId(defaults[0]?.id || '')
      setForceLayerRender(false)
      setStatus(saved ? `已识别 ${flat.length} 个图层，并补齐 ${defaults.length} 个槽位` : `已识别 ${flat.length} 个图层`)
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
    const demoSlots = buildDemoSlots(flat)
    setSlots(demoSlots)
    setRows([])
    setSheetName('')
    setDownload(null)
    setPreviewIndex(0)
    setActiveSlotId(demoSlots[0]?.id || '')
    setForceLayerRender(false)
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
      const demoSlots = buildDemoSlots(flat)
      setSlots(demoSlots)
      setRows([
        { 页面名称: '张三_新人价', 姓名: '张三', Logo: 'logo-a.png', 商品图: 'product-a.png', 角标文案: '新人价', 价格: '¥129' },
        { 页面名称: '李四_会员价', 姓名: '李四', Logo: 'logo-b.png', 商品图: 'product-b.png', 角标文案: '会员价', 价格: '¥159' },
        { 页面名称: '王五_限时价', 姓名: '王五', Logo: 'logo-c.png', 商品图: 'product-c-wide.png', 角标文案: '限时价', 价格: '¥199' },
        { 页面名称: '赵六_秒杀价', 姓名: '赵六', Logo: 'logo-d.png', 商品图: 'product-d-tall.png', 角标文案: '秒杀价', 价格: '¥89' },
      ])
      setSheetName('demo-data.csv')
      setDownload(null)
      setPreviewIndex(0)
      setActiveSlotId(demoSlots[0]?.id || '')
      setForceLayerRender(false)
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

  const handleFonts = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) =>
      /\.(ttf|otf|woff2?|ttc)$/i.test(file.name),
    )
    if (!files.length) return
    setBusy(true)
    setStatus('读取字体')
    try {
      const assets = await Promise.all(files.map(fontFromFile))
      setFonts((previous) => {
        previous.forEach((asset) => URL.revokeObjectURL(asset.url))
        return assets
      })
      setStatus(`已载入 ${assets.length} 个字体`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '字体读取失败')
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

  const applyTextElements = () => {
    if (!activeSlot) {
      setStatus('先选择要替换的 PSD 图层')
      return
    }
    const values = parseElementList(elementText)
    if (!values.length) {
      setStatus('先输入要替换的名字，一行一个')
      return
    }
    const item = layerById.get(activeSlot.id)
    const box = item ? slotBox(item.layer, activeSlot) : undefined
    const recommendedFontSize = box ? directTextSize(box.width, box.height) : 64
    const nextFontSize = Math.max(activeSlot.fontSize ?? 0, recommendedFontSize)
    const currentColor = activeSlot.color?.toLowerCase()
    const nextColor =
      activeSlot.color && (item?.kind === 'text' || currentColor !== '#ffffff')
        ? activeSlot.color
        : readableTextColorForLayer(item?.layer)
    updateSlot(activeSlot.id, {
      type: 'text',
      fontSize: nextFontSize,
      color: nextColor,
      align: activeSlot.align ?? 'center',
      weight: activeSlot.weight ?? 900,
    })
    setRows(
      values.map((value, index) => ({
        页面名称: safeName(value || `第${index + 1}张`),
        [directSlotIdKey]: activeSlot.id,
        [directKindKey]: 'text',
        [activeSlot.alias]: value,
      })),
    )
    setSheetName('手动输入')
    setDownload(null)
    setPreviewIndex(0)
    setStatus(`已生成 ${values.length} 个「${activeSlot.alias}」替换结果`)
  }

  const applyImageElements = () => {
    if (!activeSlot) {
      setStatus('先选择要替换的 PSD 图层')
      return
    }
    if (!images.length) {
      setStatus('先上传要替换的图片元素')
      return
    }
    if (activeSlot.type !== 'image') {
      updateSlot(activeSlot.id, { type: 'image', mode: activeSlot.mode ?? 'fill', mask: activeSlot.mask ?? 'rect' })
    }
    setRows(
      images.map((asset) => ({
        页面名称: asset.stem,
        [directSlotIdKey]: activeSlot.id,
        [directKindKey]: 'image',
        [activeSlot.alias]: asset.name,
      })),
    )
    setSheetName('批量图片')
    setDownload(null)
    setPreviewIndex(0)
    setStatus(`已生成 ${images.length} 个「${activeSlot.alias}」替换结果`)
  }

  const toggleSlot = (item: FlatLayer) => {
    if (!canUseAsSlot(item)) return
    setActiveSlotId(item.id)
    setSlots((previous) => {
      if (previous.some((slot) => slot.id === item.id)) {
        return previous
      }
      const used = new Set(previous.map((slot) => slot.alias.toLowerCase()))
      return [...previous, slotFromLayer(item, used)]
    })
  }

  const updateSlot = (id: string, patch: Partial<SlotConfig>) => {
    setSlots((previous) => previous.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)))
  }

  const updateSlotNumber = (id: string, key: 'left' | 'top' | 'width' | 'height', value: string) => {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed)) return
    updateSlot(id, { [key]: Math.max(key === 'width' || key === 'height' ? 1 : 0, parsed) })
  }

  const getSlotNumber = (slot: SlotConfig, key: 'left' | 'top' | 'width' | 'height') => {
    const item = layerById.get(slot.id)
    if (!item) return slot[key] ?? 0
    return Math.round(slotBox(item.layer, slot)[key])
  }

  const resetSlots = () => {
    const defaults = pickDefaultSlots(layers)
    setSlots(defaults)
    setActiveSlotId(defaults[0]?.id || '')
  }

  const exportZip = async () => {
    if (!psd || !generatedRows.length) return
    setBusy(true)
    setStatus('生成图片')
    try {
      const zip = new JSZip()
      for (let index = 0; index < generatedRows.length; index += 1) {
        const row = generatedRows[index]
        const canvas = renderPsd(psd, slots, row, images, fonts, renderMode)
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
      <input
        ref={fontInputRef}
        className="hidden-input"
        type="file"
        accept=".ttf,.otf,.woff,.woff2,.ttc"
        multiple
        onChange={handleFonts}
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
          <button type="button" onClick={() => fontInputRef.current?.click()} disabled={busy}>
            <Type size={18} />
            字体
          </button>
          <a
            href="https://github.com/siuserxiaowei/psd-batch-tool/blob/main/docs/usage.md"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={18} />
            使用说明
          </a>
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

        {generatedRows.length > 0 && slots.length > 0 && (
          <section className={`qa-strip ${errorCount ? 'has-error' : validationIssues.length ? 'has-warning' : ''}`}>
            <AlertTriangle size={17} />
            <div>
              <strong>{validationIssues.length ? `${validationIssues.length} 个数据提醒` : '数据匹配正常'}</strong>
              <span>{validationIssues[0]?.message || `${slots.length} 个槽位已匹配 ${generatedRows.length} 行数据`}</span>
            </div>
          </section>
        )}

        <section className="element-batch">
          <div className="section-title">
            <Type size={18} />
            <span>批量替换当前图层</span>
          </div>
          <div className="active-slot-pill">
            <strong>{activeSlot ? activeSlot.name : '未选择图层'}</strong>
            <span>{activeSlot ? `目标：${activeSlot.alias} · ${slotTypeLabels[activeSlot.type]}` : '先在 PSD 图层里点一个图层'}</span>
          </div>
          <p className="element-hint">下面每一行都会替换到当前图层的位置；其他图层保持 PSD 原样。</p>
          <textarea
            value={elementText}
            onChange={(event) => setElementText(event.target.value)}
            placeholder={'一行一个名字，例如：\n张三\n李四\n王五'}
          />
          <div className="element-actions">
            <button type="button" onClick={applyTextElements} disabled={!activeSlot || !elementCount}>
              替换成 {elementCount || 0} 个文字
            </button>
            <button type="button" onClick={applyImageElements} disabled={!activeSlot || !images.length}>
              替换成 {images.length} 张图片
            </button>
          </div>
        </section>

        <section className="stack">
          <div className="section-title">
            <Layers size={18} />
            <span>替换槽位</span>
            <button type="button" className="icon-button" onClick={saveTemplateConfig} disabled={!slots.length} title="保存当前 PSD 槽位配置">
              <Save size={16} />
            </button>
            <button type="button" className="icon-button" onClick={loadTemplateConfig} disabled={!psd} title="载入当前 PSD 槽位配置">
              <FolderOpen size={16} />
            </button>
            <button type="button" className="icon-button" onClick={resetSlots} disabled={!layers.length} title="重选建议槽位">
              <RefreshCcw size={16} />
            </button>
          </div>

          <div className="slot-list">
            {slots.length ? (
              slots.map((slot) => (
                <div
                  className={`slot-card ${slot.id === activeSlotId ? 'active' : ''}`}
                  key={slot.id}
                  onClick={() => setActiveSlotId(slot.id)}
                >
                  <div>
                    <strong>{slot.name}</strong>
                    <span>{slot.path}</span>
                  </div>
                  <div className={`slot-controls ${slot.type === 'text' ? 'text-slot-controls' : 'image-slot-controls'}`}>
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
                          mask: type === 'image' ? (slot.mask ?? 'rect') : slot.mask,
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
                        <select
                          className="wide-control"
                          value={slot.fontFamily ?? ''}
                          title="字体"
                          onChange={(event) => updateSlot(slot.id, { fontFamily: event.target.value })}
                        >
                          {fontOptions.map((font) => (
                            <option key={font.value || 'default'} value={font.value}>
                              {font.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={slot.align ?? 'center'}
                          title="对齐"
                          onChange={(event) => updateSlot(slot.id, { align: event.target.value as CanvasTextAlign })}
                        >
                          <option value="left">左对齐</option>
                          <option value="center">居中</option>
                          <option value="right">右对齐</option>
                        </select>
                      </>
                    ) : (
                      <>
                        <select value={slot.mode} onChange={(event) => updateSlot(slot.id, { mode: event.target.value as SlotMode })}>
                          {Object.entries(modeLabels).map(([mode, label]) => (
                            <option key={mode} value={mode}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <select value={slot.mask ?? 'rect'} onChange={(event) => updateSlot(slot.id, { mask: event.target.value as SlotMask })}>
                          {Object.entries(maskLabels).map(([mask, label]) => (
                            <option key={mask} value={mask}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  <div className="box-controls">
                    <label>
                      X
                      <input
                        type="number"
                        value={getSlotNumber(slot, 'left')}
                        onChange={(event) => updateSlotNumber(slot.id, 'left', event.target.value)}
                      />
                    </label>
                    <label>
                      Y
                      <input
                        type="number"
                        value={getSlotNumber(slot, 'top')}
                        onChange={(event) => updateSlotNumber(slot.id, 'top', event.target.value)}
                      />
                    </label>
                    <label>
                      W
                      <input
                        type="number"
                        min={1}
                        value={getSlotNumber(slot, 'width')}
                        onChange={(event) => updateSlotNumber(slot.id, 'width', event.target.value)}
                      />
                    </label>
                    <label>
                      H
                      <input
                        type="number"
                        min={1}
                        value={getSlotNumber(slot, 'height')}
                        onChange={(event) => updateSlotNumber(slot.id, 'height', event.target.value)}
                      />
                    </label>
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
            <span>PSD 图层（点一下作为目标）</span>
          </div>
          <div className="layer-list">
            {layers.length ? (
              layers.map((item) => (
                <button
                  type="button"
                  className={`layer-row ${selectedIds.has(item.id) ? 'selected' : ''} ${item.id === activeSlotId ? 'active-slot' : ''}`}
                  key={item.id}
                  style={{ paddingLeft: `${12 + item.depth * 14}px` }}
                  onClick={() => toggleSlot(item)}
                  disabled={!canUseAsSlot(item)}
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
            <p>
              {slotAliases || '导入 PSD 后选择可替换图层'}
              {psd && <span className="render-mode"> · {renderMode === 'composite' ? '合成图预览' : '图层预览'}</span>}
            </p>
          </div>
          {psd && (
            <div className="view-tools">
              <button type="button" onClick={() => setShowGuides((value) => !value)}>
                {showGuides ? '隐藏框' : '显示框'}
              </button>
              <button type="button" onClick={() => setForceLayerRender((value) => !value)}>
                {forceLayerRender ? '自动预览' : '图层预览'}
              </button>
            </div>
          )}
          <div className="status-pill">
            {busy ? <Loader2 className="spin" size={16} /> : <Archive size={16} />}
            <span>{status}</span>
          </div>
        </header>

        <div className="preview-stage">
          {previewUrl && psd ? (
            <div className="preview-artboard">
              <img src={previewUrl} alt="PSD preview" />
              {showGuides && guideBoxes.length > 0 && (
                <div className="preview-guides">
                  {guideBoxes.map((box) => (
                    <button
                      type="button"
                      key={box.id}
                      className={box.id === activeSlotId ? 'guide-box active' : 'guide-box'}
                      style={{
                        left: `${(box.left / psd.width) * 100}%`,
                        top: `${(box.top / psd.height) * 100}%`,
                        width: `${(box.width / psd.width) * 100}%`,
                        height: `${(box.height / psd.height) * 100}%`,
                      }}
                      onClick={() => setActiveSlotId(box.id)}
                      aria-label={`选择 ${box.alias}`}
                    >
                      <span>{guideLabels.get(box.id) || box.alias}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="preview-empty">
              <FileImage size={42} />
              <span>PSD 预览</span>
            </div>
          )}
        </div>

        {gallery.length > 0 && (
          <section className="gallery-panel">
            <div className="gallery-head">
              <strong>批量结果</strong>
              <span>{gallery.length} / {generatedRows.length} 张</span>
            </div>
            <div className="gallery-grid">
              {gallery.map((item) => (
                <button
                  type="button"
                  className={`gallery-card ${item.index === previewIndex ? 'active' : ''}`}
                  key={`${item.index}-${item.label}`}
                  onClick={() => setPreviewIndex(item.index)}
                >
                  <img src={item.url} alt={item.label} />
                  <span>{item.index + 1}. {item.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

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
