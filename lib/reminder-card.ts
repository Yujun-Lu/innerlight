import type { Meditation } from "./types";

/** Word wrapping also splits unusually long tokens rather than clipping them. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const output: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= width) { line = next; continue; }
      if (line) { output.push(line); line = ""; }
      if (context.measureText(word).width <= width) { line = word; continue; }
      for (const character of Array.from(word)) {
        if (line && context.measureText(line + character).width > width) { output.push(line); line = ""; }
        line += character;
      }
    }
    if (line) output.push(line);
  }
  return output.length ? output : [""];
}

/** A measured, high-resolution keepsake. No private story or remote assets. */
export async function createReminderPng(meditation: Meditation): Promise<Blob> {
  const scratch = document.createElement("canvas");
  const measure = scratch.getContext("2d");
  if (!measure) throw new Error("This browser could not create the reminder image.");

  let titleSize = 76;
  let titleLines: string[];
  do {
    measure.font = `${titleSize}px Georgia, serif`;
    titleLines = wrap(measure, meditation.affirmation, 960);
    if (titleLines.length <= 5 || titleSize <= 42) break;
    titleSize -= 2;
  } while (true);
  const titleLeading = titleSize * 1.21;
  measure.font = "31px Arial, sans-serif";
  const actionLines = wrap(measure, meditation.action, 960);
  const boundaryLines = wrap(measure, `“${meditation.boundary}”`, 960);
  const titleBottom = 365 + (titleLines.length - 1) * titleLeading + titleSize * 0.3;
  const actionLabelY = Math.max(760, titleBottom + 90);
  const actionBodyY = actionLabelY + 45;
  const actionBottom = actionBodyY + (actionLines.length - 1) * 45 + 10;
  const boundaryLabelY = actionBottom + 65;
  const boundaryBodyY = boundaryLabelY + 45;
  const boundaryBottom = boundaryBodyY + (boundaryLines.length - 1) * 45 + 10;
  const footerY = Math.max(1317, boundaryBottom + 85);
  const finalHeight = Math.max(1500, Math.ceil(footerY + 165));

  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = finalHeight;
  const c = canvas.getContext("2d");
  if (!c) throw new Error("This browser could not create the reminder image.");
  c.fillStyle = "#f7f4e9"; c.fillRect(0, 0, 1200, finalHeight);
  const glow = c.createRadialGradient(1040, 150, 10, 1040, 150, 570);
  glow.addColorStop(0, "#f4d596"); glow.addColorStop(0.35, "#f4dfb0"); glow.addColorStop(1, "#f7f4e9");
  c.fillStyle = glow; c.fillRect(450, 0, 750, 760);
  c.strokeStyle = "#d2cfb7"; c.lineWidth = 1.5; c.strokeRect(48, 48, 1104, finalHeight - 96);
  c.fillStyle = "#2e4838"; c.font = "43px Georgia, serif"; c.fillText("Innerlight", 105, 132);
  c.fillStyle = "#6e765f"; c.font = "16px Arial, sans-serif";
  c.fillText("R E T U R N   T O   Y O U R S E L F", 108, 170);

  c.beginPath(); c.arc(1053, 114, 24, 0, Math.PI * 2); c.strokeStyle = "#9d9f72"; c.stroke();
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6;
    c.beginPath(); c.moveTo(1053 + Math.cos(angle) * 32, 114 + Math.sin(angle) * 32);
    c.lineTo(1053 + Math.cos(angle) * 40, 114 + Math.sin(angle) * 40); c.stroke();
  }
  c.fillStyle = "#8b7853"; c.font = "17px Arial, sans-serif";
  c.fillText(meditation.source === "sample" ? "A FICTIONAL SAMPLE · A THOUGHT TO KEEP" : "A THOUGHT TO KEEP", 108, 282);
  c.fillStyle = "#3e5340"; c.font = `${titleSize}px Georgia, serif`;
  titleLines.forEach((line, index) => c.fillText(line, 105, 365 + index * titleLeading));

  const section = (label: string, labelY: number, content: string[], bodyY: number) => {
    c.fillStyle = "#7c8066"; c.font = "18px Arial, sans-serif"; c.fillText(label, 108, labelY);
    c.fillStyle = "#4e5d49"; c.font = "31px Arial, sans-serif";
    content.forEach((line, index) => c.fillText(line, 108, bodyY + index * 45));
  };
  section("ONE SMALL CHOICE", actionLabelY, actionLines, actionBodyY);
  section("WORDS YOU CAN BORROW", boundaryLabelY, boundaryLines, boundaryBodyY);
  c.strokeStyle = "#d2cfb7"; c.beginPath(); c.moveTo(108, footerY); c.lineTo(1092, footerY); c.stroke();
  c.fillStyle = "#777d65"; c.font = "italic 26px Georgia, serif"; c.fillText("Care can flow both ways.", 108, footerY + 56);
  c.font = "15px Arial, sans-serif"; c.fillText("A LITTLE LIGHT FOR EVERYDAY LIFE.", 108, footerY + 94);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The reminder image could not be created.")), "image/png"));
}
