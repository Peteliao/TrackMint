import { wgs84ToGcj02 } from './coords';
import type { CheckInKind, PreferredNavMap, SafetyPosition, SafetySettings } from './safety';

export interface NavigationLink {
  map: Exclude<PreferredNavMap, 'all'>;
  label: string;
  url: string;
}

export interface SafetyMessage {
  title: string;
  subject: string;
  text: string;
  smsText: string;
  links: NavigationLink[];
}

const isChinese = (language: string) => /^zh/i.test(language);
const localeFor = (language: string) => isChinese(language) ? 'zh-CN' : 'en-US';
const fixed = (value: number, digits = 6) => (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits);

function formatTime(timestamp: number, language: string): string {
  try {
    return new Intl.DateTimeFormat(localeFor(language), {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short'
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function formatDuration(durationMs: number, chinese: boolean): string {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  return chinese ? `${hours}小时${minutes}分${seconds}秒` : clock;
}

export function buildNavigationLinks(position: SafetyPosition, preferred: PreferredNavMap, language: string): NavigationLink[] {
  const chinese = isChinese(language);
  const [gcjLon, gcjLat] = wgs84ToGcj02(position.lon, position.lat);
  const name = encodeURIComponent(chinese ? '我的安全位置' : 'My safety location');
  const all: NavigationLink[] = [
    {
      map: 'amap',
      label: chinese ? '高德地图导航（已纠偏）' : 'AMap navigation (China-corrected)',
      url: `https://uri.amap.com/marker?position=${fixed(gcjLon)},${fixed(gcjLat)}&name=${name}&coordinate=gcj02&callnative=1`
    },
    {
      map: 'google',
      label: chinese ? 'Google 地图导航' : 'Google Maps navigation',
      url: `https://www.google.com/maps/search/?api=1&query=${fixed(position.lat)},${fixed(position.lon)}`
    },
    {
      map: 'apple',
      label: chinese ? 'Apple 地图查看' : 'Apple Maps view',
      url: `https://maps.apple.com/?ll=${fixed(position.lat)},${fixed(position.lon)}&q=${name}`
    }
  ];
  return preferred === 'all' ? all : all.filter((link) => link.map === preferred);
}

export function buildSafetyMessage(
  position: SafetyPosition,
  settings: SafetySettings,
  kind: CheckInKind,
  language: string
): SafetyMessage {
  const chinese = isChinese(language);
  const alias = settings.senderAlias.trim() || (chinese ? '我的设备' : 'My device');
  const timestamp = position.timestamp || Date.now();
  const time = formatTime(timestamp, language);
  const title = kind === 'sos'
    ? (chinese ? '【SOS 紧急求助】RoamEtch 安全位置报备' : '[SOS EMERGENCY] RoamEtch Safety Check-in')
    : kind === 'test'
      ? (chinese ? '【测试】RoamEtch 安全位置报备' : '[TEST] RoamEtch Safety Check-in')
      : (chinese ? '【RoamEtch 安全位置报备】' : '[RoamEtch Safety Check-in]');
  const links = buildNavigationLinks(position, settings.preferredNavMap, language);
  const stateLabels = chinese
    ? { idle: '待机', recording: '行程进行中', paused: '行程已暂停', finished: '行程已结束' }
    : { idle: 'Idle', recording: 'Trip in progress', paused: 'Trip paused', finished: 'Trip finished' };
  const state = stateLabels[position.recordingState || 'idle'];
  const coordinates = `${fixed(position.lat)}, ${fixed(position.lon)}`;
  const accuracy = Number.isFinite(position.accuracy)
    ? ` ±${Math.max(0, Math.round(position.accuracy!))}m`
    : '';
  const lines = [
    title,
    chinese ? `报备人：${alias}` : `Sender: ${alias}`,
    chinese ? `定位时间：${time}` : `Located: ${time}`,
    chinese ? `精确坐标 (WGS-84)：${coordinates}${accuracy}` : `Exact coordinates (WGS-84): ${coordinates}${accuracy}`,
    chinese ? `运动状态：${state}` : `Activity: ${state}`
  ];
  if (Number.isFinite(position.altitude)) lines.push(chinese ? `海拔：${Math.round(position.altitude!)} m` : `Altitude: ${Math.round(position.altitude!)} m`);
  if (Number.isFinite(position.distanceM)) lines.push(chinese ? `已走：${(position.distanceM! / 1000).toFixed(1)} km` : `Distance: ${(position.distanceM! / 1000).toFixed(1)} km`);
  if (Number.isFinite(position.durationMs)) lines.push(chinese ? `时长：${formatDuration(position.durationMs!, chinese)}` : `Duration: ${formatDuration(position.durationMs!, chinese)}`);
  if (Number.isFinite(position.batteryLevel)) lines.push(chinese ? `设备电量：${Math.round(position.batteryLevel! * 100)}%` : `Battery: ${Math.round(position.batteryLevel! * 100)}%`);
  lines.push('', chinese ? '一键导航直达：' : 'Open navigation:');
  for (const link of links) lines.push(`- ${link.label}: ${link.url}`);
  lines.push('', chinese ? '本消息由 RoamEtch 安全定位报备功能发送，请结合实际情况核实位置。' : 'Sent by RoamEtch Safety Check-in. Please verify the location against real-world conditions.');
  const text = lines.join('\n');
  const compactLines = [
    title,
    `${chinese ? '报备人' : 'Sender'}: ${alias}`,
    `${chinese ? '时间' : 'Time'}: ${time}`,
    `WGS-84: ${coordinates}${accuracy}`,
    Number.isFinite(position.batteryLevel) ? `${chinese ? '电量' : 'Battery'}: ${Math.round(position.batteryLevel! * 100)}%` : '',
    ...links.map((link) => `${link.label}: ${link.url}`)
  ].filter(Boolean);
  return { title, subject: title, text, smsText: compactLines.join('\n'), links };
}

export function buildMailtoHref(emails: string[], message: SafetyMessage): string {
  return `mailto:${encodeURIComponent(emails.join(','))}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.text)}`;
}

export function buildSmsHref(phone: string, message: SafetyMessage): string {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message.smsText)}`;
}
