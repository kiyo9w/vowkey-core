import { svg } from "../svg";

/**
 * Exception: SVGs should not reference color variables directly, but the beta
 * badge is an intentional exception because its gradient colors do not map to existing
 * defined values. Do not follow this pattern for other SVGs.
 */
export const VowkeyLogoBeta = svg`
  <svg viewBox="0 0 290 45" xmlns="http://www.w3.org/2000/svg">
    <title>Vowkey</title>
    <g transform="translate(0 3.15)"><svg width="51.6" height="38.7" viewBox="12 22 96 72">
      <path d="M70 40H93a9 9 0 0 1 9 9v28a9 9 0 0 1-9 9H27a9 9 0 0 1-9-9V49a9 9 0 0 1 9-9h1" fill="none" stroke-width="7" stroke-linecap="round" style="stroke: var(--vk-ink, rgb(var(--color-text-main)))"/>
      <rect x="31" y="28" width="34" height="23" rx="5" style="fill: var(--vk-blue, #2563EB)"/>
      <rect x="37.5" y="37.75" width="21" height="3.5" rx="1.75" fill="#fff"/>
      <g style="fill: var(--vk-ink, rgb(var(--color-text-main)))"><circle cx="35" cy="65" r="5"/><circle cx="51" cy="65" r="5"/><circle cx="67" cy="65" r="5"/></g>
      <rect x="80" y="54" width="5.5" height="22" rx="2.75" style="fill: var(--vk-blue, #2563EB)"/>
    </svg></g>
    <text x="60.5" y="33.4" font-family="'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="31.5" font-weight="800" letter-spacing="-0.8" style="fill: var(--vk-ink, rgb(var(--color-text-main)))">Vowkey</text>
  </svg>
`;
