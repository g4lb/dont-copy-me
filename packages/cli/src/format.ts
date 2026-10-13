import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

const useColor = (): boolean => process.env.NO_COLOR === undefined && (process.env.FORCE_COLOR !== undefined || Boolean(process.stderr.isTTY));

export function paint(style: Style, text: string): string {
  return useColor() ? styleText(style, text) : text;
}

export function statusIcon(status: string): string {
  switch (status) {
    case 'pass':
      return paint('green', '✔');
    case 'fail':
      return paint('red', '✖');
    case 'warn':
      return paint('yellow', '⚠');
    default:
      return paint('gray', '–');
  }
}

