import { PNG } from "pngjs";

export function composeContactSheetPng(
  framePngs: Buffer[],
  options: { columns?: number; rows?: number } = {},
): Buffer {
  if (framePngs.length === 0) {
    throw new Error("Cannot compose contact sheet without frames");
  }

  const columns = options.columns ?? 2;
  const rows = options.rows ?? 3;
  const decoded = framePngs
    .slice(-columns * rows)
    .map((buffer) => PNG.sync.read(buffer));
  const cellWidth = decoded[decoded.length - 1].width;
  const cellHeight = decoded[decoded.length - 1].height;
  const sheet = new PNG({
    width: cellWidth * columns,
    height: cellHeight * rows,
  });

  fill(sheet, 18, 18, 16, 255);

  decoded.forEach((frame, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    copyFrame(frame, sheet, column * cellWidth, row * cellHeight, cellWidth, cellHeight);
  });

  return PNG.sync.write(sheet);
}

function fill(png: PNG, r: number, g: number, b: number, a: number): void {
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = r;
    png.data[index + 1] = g;
    png.data[index + 2] = b;
    png.data[index + 3] = a;
  }
}

function copyFrame(source: PNG, target: PNG, offsetX: number, offsetY: number, cellWidth: number, cellHeight: number): void {
  const width = Math.min(source.width, cellWidth);
  const height = Math.min(source.height, cellHeight);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (source.width * y + x) << 2;
      const targetIndex = (target.width * (offsetY + y) + offsetX + x) << 2;
      target.data[targetIndex] = source.data[sourceIndex];
      target.data[targetIndex + 1] = source.data[sourceIndex + 1];
      target.data[targetIndex + 2] = source.data[sourceIndex + 2];
      target.data[targetIndex + 3] = source.data[sourceIndex + 3];
    }
  }
}
