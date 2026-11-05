/**
 * 答辩 PPTX 导出
 *
 * 版式是干净的扁平实底：白纸、深墨字、一个主色，靠微明度分层，
 * 不用渐变、阴影、三维或毛玻璃。全部文字都在幻灯片里（不是图片），
 * 用户拿到 PowerPoint / WPS 里还能继续改。
 *
 * 数据页只画项目里真实存在的数据集；模拟数据用琥珀色条并带标识。
 * 每页写演讲备注，页脚固定「AI 生成内容需核实」。
 */
import PptxGenJS from 'pptxgenjs';
import type { Dataset, Deck, Project, SlideItem } from '../core/types';
import { deckToNotes, type DeckFacts } from '../ppt/model';
import { downloadBlob, safeName } from './bundle';

type Pptx = InstanceType<typeof PptxGenJS>;
type Slide = ReturnType<Pptx['addSlide']>;

const C = {
  paper: 'FFFFFF',
  ink: '1B1C1E',
  sub: '6B6E75',
  primary: '1F4FD8',
  soft: 'F4F6FC',
  band: 'E4EBFA',
  track: 'EDF0F5',
  sim: 'B8791A',
} as const;

/** 用常见中文字体名，不嵌入字体：不同设备上由系统替换 */
const FONT = 'Microsoft YaHei';

const M = 0.72;
const W = 11.9;

interface TextOpts {
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  size?: number;
  color?: string;
}

export async function buildPptx(deck: Deck, project: Project, datasets: Dataset[]): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '研学帮 StudyMate';
  pptx.company = project.school || '研学帮 StudyMate';
  pptx.subject = '研究性学习结题答辩（AI 辅助整理，内容需核实）';
  pptx.title = deck.title || '结题答辩';

  const text = (slide: Slide, t: string, x: number, y: number, w: number, h: number, o: TextOpts = {}) => {
    slide.addText(t || '', {
      x, y, w, h,
      fontSize: o.size ?? 16,
      bold: !!o.bold,
      color: o.color ?? C.ink,
      fontFace: FONT,
      align: o.align ?? 'left',
      valign: o.valign ?? 'middle',
      margin: 0,
      wrap: true,
      fit: 'shrink',
      breakLine: false,
      isTextBox: true,
    });
  };

  const rect = (slide: Slide, x: number, y: number, w: number, h: number, color: string) => {
    slide.addShape(pptx.ShapeType.rect, {
      x, y, w, h,
      fill: { color },
      line: { color, width: 0 },
      rectRadius: 0,
    } as Parameters<Slide['addShape']>[1]);
  };

  const footer = (slide: Slide, page: number, total: number, sim: boolean) => {
    rect(slide, M, 6.86, W, 0.01, C.track);
    text(
      slide,
      `AI 生成内容需核实 · 研学帮 StudyMate${sim ? ' · （AI 模拟示例）' : ''}`,
      M, 6.96, 9.4, 0.3,
      { size: 9.5, color: C.sub },
    );
    text(slide, `${page} / ${total}`, 11.4, 6.96, 1.2, 0.3, { size: 9.5, color: C.sub, align: 'right' });
  };

  const total = deck.slides.length;
  deck.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: C.paper };
    const page = i + 1;
    if (s.note) slide.addNotes(s.note);
    renderSlide(slide, s, page, total, datasets, { text, rect, footer });
  });

  const out = await pptx.write({ outputType: 'blob' });
  if (!(out instanceof Blob)) throw new Error('演示文稿生成失败：没有拿到文件内容');
  return out;
}

interface Draw {
  text: (slide: Slide, t: string, x: number, y: number, w: number, h: number, o?: TextOpts) => void;
  rect: (slide: Slide, x: number, y: number, w: number, h: number, color: string) => void;
  footer: (slide: Slide, page: number, total: number, sim: boolean) => void;
}

function renderSlide(
  slide: Slide,
  s: SlideItem,
  page: number,
  total: number,
  datasets: Dataset[],
  d: Draw,
) {
  const sim = !!s.simulated;
  const bullets = s.bullets.filter(Boolean).slice(0, 4);

  if (s.layout === 'cover') {
    d.rect(slide, 0, 0, 0.22, 7.5, C.primary);
    d.rect(slide, 0.22, 0, 12.9, 7.5, C.paper);
    d.text(slide, s.kicker || '研究性学习 · 结题答辩', 1.0, 0.85, 10.6, 0.36, { size: 12, color: C.primary });
    d.text(slide, s.title, 1.0, 1.65, 11.0, 1.75, { size: 36, bold: true, valign: 'middle' });
    d.rect(slide, 1.0, 3.6, 1.5, 0.045, C.primary);
    if (s.lead) d.text(slide, s.lead, 1.0, 3.85, 10.8, 0.5, { size: 16, color: C.sub });
    bullets.forEach((b, i) => {
      d.text(slide, b, 1.0, 4.6 + i * 0.46, 10.8, 0.4, { size: 14 });
    });
    d.text(slide, 'AI 辅助整理，提交前请按学校要求核对', 1.0, 6.5, 10.8, 0.35, { size: 10, color: C.sub });
    d.footer(slide, page, total, sim);
    return;
  }

  if (s.layout === 'section') {
    slide.background = { color: C.soft };
    d.rect(slide, 0, 0, 0.22, 7.5, C.primary);
    d.text(slide, s.kicker || String(page - 1).padStart(2, '0'), 1.05, 1.55, 6.0, 1.5, { size: 66, bold: true, color: C.band });
    d.text(slide, s.title, 1.05, 3.15, 10.8, 1.0, { size: 34, bold: true });
    if (s.lead) d.text(slide, s.lead, 1.05, 4.35, 10.4, 0.6, { size: 15, color: C.sub });
    d.footer(slide, page, total, sim);
    return;
  }

  if (s.layout === 'end') {
    d.rect(slide, 0, 0, 13.333, 0.16, C.primary);
    d.text(slide, s.title, 1.0, 2.0, 11.3, 1.1, { size: 38, bold: true, align: 'center' });
    if (s.lead) d.text(slide, s.lead, 1.0, 3.25, 11.3, 0.5, { size: 15, color: C.primary, align: 'center' });
    bullets.forEach((b, i) => {
      d.text(slide, b, 1.6, 4.05 + i * 0.46, 10.1, 0.4, { size: 13, color: C.sub, align: 'center' });
    });
    d.text(slide, '指导教师意见由教师本人填写 · 模拟内容不得作为真实研究结果', 1.0, 6.4, 11.3, 0.35, {
      size: 10, color: C.sub, align: 'center',
    });
    d.footer(slide, page, total, sim);
    return;
  }

  /* 内容页通用头部 */
  if (s.kicker) d.text(slide, s.kicker, M, 0.42, W, 0.3, { size: 11, color: C.primary });
  d.text(slide, s.title, M, 0.82, W, 0.78, { size: 27, bold: true, valign: 'middle' });
  d.rect(slide, M, 1.66, W, 0.012, C.track);

  if (s.lead) {
    d.rect(slide, M, 1.86, W, 0.72, C.soft);
    d.rect(slide, M, 1.86, 0.055, 0.72, C.primary);
    d.text(slide, s.lead, M + 0.24, 1.9, W - 0.48, 0.64, { size: 15.5, bold: true, color: C.primary });
  }

  const bodyTop = s.lead ? 2.82 : 1.98;

  if (s.layout === 'two') {
    const half = (W - 0.32) / 2;
    [0, 1].forEach((col) => {
      const x = M + col * (half + 0.32);
      d.rect(slide, x, bodyTop, half, 3.3, C.soft);
      const items = bullets.filter((_, i) => i % 2 === col);
      d.text(slide, col === 0 ? '已经做到的' : '还需补充的', x + 0.28, bodyTop + 0.22, half - 0.56, 0.4, {
        size: 13, bold: true, color: C.primary,
      });
      (items.length ? items : ['待补充']).slice(0, 3).forEach((b, i) => {
        d.text(slide, b, x + 0.28, bodyTop + 0.82 + i * 0.72, half - 0.56, 0.62, { size: 15, valign: 'top' });
      });
    });
  } else if (s.layout === 'data') {
    const ds = datasets.find((x) => x.id === s.datasetId);
    if (ds && ds.points.length) {
      const pts = ds.points.slice(0, 8);
      const max = Math.max(...pts.map((p) => Math.abs(p.value)), 1);
      const barColor = sim || ds.sourceType === 'simulated' ? C.sim : C.primary;
      pts.forEach((pt, i) => {
        const y = bodyTop + 0.1 + i * 0.5;
        d.text(slide, String(pt.label), M, y, 2.7, 0.36, { size: 12.5 });
        d.rect(slide, 3.55, y + 0.06, 7.1, 0.24, C.track);
        d.rect(slide, 3.55, y + 0.06, Math.max(0.06, (7.1 * Math.abs(pt.value)) / max), 0.24, barColor);
        d.text(slide, `${pt.value}${ds.unit ?? ''}`, 10.85, y, 1.55, 0.36, { size: 12.5, align: 'right' });
      });
      const note = [
        `图：${ds.title}`,
        `来源：${ds.sourceNote || '待补充'}`,
        `单位：${ds.unit || '未填写'}`,
        sim || ds.sourceType === 'simulated' ? '（AI 模拟示例）' : '',
      ].filter(Boolean).join('　');
      d.text(slide, note, M, 6.4, W, 0.34, { size: 10, color: C.sub });
    } else {
      d.text(slide, '项目里还没有可用的数据集，这张图先留空。', M, bodyTop + 0.4, W, 0.6, { size: 16, color: C.sub });
      d.text(slide, '待补充：样本量、数据来源、统计口径', M, bodyTop + 1.1, W, 0.5, { size: 14, color: C.sub });
    }
  } else {
    (bullets.length ? bullets : ['待补充']).forEach((b, i) => {
      const y = bodyTop + 0.16 + i * 0.78;
      d.rect(slide, M + 0.02, y + 0.19, 0.11, 0.11, C.primary);
      d.text(slide, b, M + 0.34, y, W - 0.5, 0.62, { size: 17.5, valign: 'middle' });
    });
  }

  if (s.source) {
    d.text(slide, `依据：${s.source}`, M, 6.42, W, 0.34, { size: 10, color: C.sub });
  }
  d.footer(slide, page, total, sim);
}

/** 下载 PPTX（真正的 Office Open XML 演示文稿） */
export async function exportDeckPptx(deck: Deck, project: Project, datasets: Dataset[]): Promise<void> {
  const blob = await buildPptx(deck, project, datasets);
  downloadBlob(blob, `${safeName(project.topic)}_结题答辩.pptx`);
}

/** 讲稿：和 PPT 一一对应，方便自己改成口播词 */
export function exportDeckNotes(deck: Deck, facts: DeckFacts): void {
  const md = deckToNotes(deck, facts);
  downloadBlob(
    new Blob([md], { type: 'text/markdown;charset=utf-8' }),
    `${safeName(facts.project.topic)}_答辩讲稿.md`,
  );
}
