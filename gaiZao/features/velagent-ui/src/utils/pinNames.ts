/**
 * 引脚名解析。
 *
 * 画布上的引脚名来自元素自身的 pinInfo（wokwi 元素约定）。AI / JSON 里写的
 * 名字可能是别名（D13 / 13、3.3V / 3V3、面包板孔 a5 / 内部 5t.a），这里统一
 * 解析成 pinInfo 里真实存在的名字；解析不到时调用方可以拿到可用引脚列表报错。
 */
import { readPinInfo } from './readPinInfo';

const BREADBOARD_IDS = new Set(['breadboard', 'breadboard-mini']);

/** 是否是面包板型号（孔位命名与普通元件不同）。 */
export function isBreadboardMetadata(metadataId: string): boolean {
  return BREADBOARD_IDS.has(metadataId);
}

/** 面包板孔名（用户坐标 a5 / f12 / 电源轨 tp.1）→ 内部 pinInfo 名（5t.a / 12b.f / tp.1）。 */
export function breadboardHoleName(hole: string): string | null {
  if (/^(tp|tn|bp|bn)\.\d+$/.test(hole)) return hole;
  const m = /^([a-j])(\d{1,2})$/.exec(hole);
  if (m) {
    const row = m[1];
    const col = Number(m[2]);
    return row <= 'e' ? col + 't.' + row : col + 'b.' + row;
  }
  return null;
}

/** 内部 pinInfo 名 → 用户坐标（5t.a → a5、12b.f → f12、电源轨原样）。 */
export function breadboardPinName(pin: string): string {
  const m = /^(\d+)([tb])\.([a-j])$/.exec(pin);
  if (m) return m[3] + m[1];
  return pin;
}

/** 元素上真实的引脚名列表（未挂载 / 没有 pinInfo 时返回 null）。 */
export function pinNamesOf(ownerId: string): string[] | null {
  if (typeof document === 'undefined') return null;
  const element = document.getElementById(ownerId);
  const info = readPinInfo<{ name: string }>(element);
  if (!info) return null;
  return info.map((pin) => pin.name);
}

/**
 * 对外的引脚列表：面包板给用户坐标（孔名 a5 / tp.1），其它元件给 pinInfo 名。
 * @param ownerId - 板卡 / 元件的画布 id。
 * @param metadataId - 型号（面包板与非面包板命名不同）。
 * @returns 引脚名数组，元素未挂载时返回 null。
 */
export function visiblePinNames(ownerId: string, metadataId: string): string[] | null {
  const names = pinNamesOf(ownerId);
  if (!names) return null;
  return isBreadboardMetadata(metadataId) ? names.map(breadboardPinName) : names;
}

/**
 * 把用户 / AI 写的引脚名解析成画布实际存储的规范名。
 * @param ownerId - 板卡 / 元件的画布 id。
 * @param metadataId - 型号。
 * @param pin - 用户写的引脚名（可能是别名或面包板孔名）。
 * @returns 规范引脚名；解析不到返回 null。
 */
export function resolvePinName(ownerId: string, metadataId: string, pin: string): string | null {
  const names = pinNamesOf(ownerId);
  if (!names) return null;
  const wanted = pin.trim();
  if (!wanted) return null;
  const exact = names.find((name) => name === wanted);
  if (exact) return exact;
  if (isBreadboardMetadata(metadataId)) {
    const hole = breadboardHoleName(wanted);
    if (hole && names.includes(hole)) return hole;
    return null;
  }
  const lower = wanted.toLowerCase();
  const caseHit = names.find((name) => name.toLowerCase() === lower);
  if (caseHit) return caseHit;
  // 别名兜底，规则与 utils/pinPositionCalculator 的解析保持一致。
  const candidates: string[] = [];
  if (!wanted.includes('.')) candidates.push(wanted + '.1');
  const dotted = /^(.+)\.\d+$/.exec(wanted);
  if (dotted) candidates.push(dotted[1]);
  if (wanted === '3.3V') candidates.push('3V3', '3V3.1', '3V');
  if (wanted === '3V3') candidates.push('3V3.1', '3.3V', '3V');
  if (wanted === '5V') candidates.push('5V.1', 'VBUS', 'VIN');
  if (wanted === 'GND2') candidates.push('GND.2');
  const dNum = /^D(\d+)$/.exec(wanted);
  if (dNum) candidates.push(dNum[1], 'GP' + dNum[1]);
  if (/^\d+$/.test(wanted)) candidates.push('D' + wanted, 'GP' + wanted);
  for (const candidate of candidates) {
    const hit = names.find((name) => name === candidate);
    if (hit) return hit;
  }
  return null;
}
