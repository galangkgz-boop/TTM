import * as qz from "qz-tray";

const DEFAULT_PRINTER_NAME = "EPPOS";
const RECEIPT_WIDTH = 32;

function money(value) {
  return Number(value || 0).toLocaleString("id-ID");
}

function centerText(text, width = RECEIPT_WIDTH) {
  const cleanText = String(text || "").trim();

  if (cleanText.length >= width) {
    return cleanText.slice(0, width);
  }

  const leftPadding = Math.floor((width - cleanText.length) / 2);
  return " ".repeat(leftPadding) + cleanText;
}

function padReceiptLine(left, right, width = RECEIPT_WIDTH) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const spaceCount = Math.max(1, width - leftText.length - rightText.length);

  return leftText + " ".repeat(spaceCount) + rightText;
}

function padThreeColumns(left, middle, right, width = RECEIPT_WIDTH) {
  const leftText = String(left || "");
  const middleText = String(middle || "");
  const rightText = String(right || "");

  const leftWidth = 10;
  const middleWidth = 8;
  const rightWidth = width - leftWidth - middleWidth;

  return (
    leftText.padEnd(leftWidth, " ").slice(0, leftWidth) +
    middleText.padEnd(middleWidth, " ").slice(0, middleWidth) +
    rightText.padStart(rightWidth, " ").slice(-rightWidth)
  );
}

function wrapReceiptText(text, maxLength = RECEIPT_WIDTH) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  words.forEach((word) => {
    const nextLine = currentLine ? currentLine + " " + word : word;

    if (nextLine.length > maxLength) {
      if (currentLine) {
        lines.push(currentLine);
      }

      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function buildReceiptHeader(settings) {
  const storeName = String(settings?.storeName || "TOKO TELON MINDI").toUpperCase();
  const address = String(settings?.address || "").toUpperCase();
  const phone = String(settings?.phone || "");

  return [
    centerText(storeName),
    ...wrapReceiptText(address, RECEIPT_WIDTH).map(centerText),
    phone ? centerText("WA: " + phone) : "",
  ].filter(Boolean);
}

export function buildThermalReceipt(transaction, settings = {}) {
  const line = "--------------------------------\n";
  const note = settings.receiptNote || "Terima kasih sudah belanja.";

  const itemLines = (transaction.items || [])
    .map((item) => {
      const name = String(item.name || item.productName || "-")
        .toUpperCase()
        .slice(0, RECEIPT_WIDTH);

      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      const subtotal = Number(item.subtotal || qty * price);

      return (
        name +
        "\n" +
        padThreeColumns(money(price), "x " + qty, money(subtotal)) +
        "\n"
      );
    })
    .join("");

  return [
    "\x1B\x40",
    "\x1B\x61\x01",
    ...buildReceiptHeader(settings).map((text) => text + "\n"),
    "\x1B\x61\x00",
    line,
    "No: " + (transaction.code || "-") + "\n",
    "Tgl: " +
      new Date(transaction.date).toLocaleString("id-ID", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }) +
      "\n",
    "Bayar: " + (transaction.paymentMethod || "Cash") + "\n",
    line,
    itemLines,
    line,
    padReceiptLine("Subtotal", money(transaction.subtotal || 0)) + "\n",
    Number(transaction.discount || 0) > 0
      ? padReceiptLine("Diskon", "-" + money(transaction.discount || 0)) + "\n"
      : "",
    padReceiptLine("TOTAL", money(transaction.total || 0)) + "\n",
    padReceiptLine("Tunai", money(transaction.cashReceived || 0)) + "\n",
    padReceiptLine("Kembali", money(transaction.change || 0)) + "\n",
    line,
    "\x1B\x61\x01",
    note + "\n",
    "\n\n\n",
    "\x1D\x56\x00",
  ];
}

export async function connectQzTray() {
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
}

export async function testQzConnection() {
  await connectQzTray();
  return qz.websocket.isActive();
}

export async function printThermalReceiptQz(transaction, settings = {}) {
  await connectQzTray();

  const printerName = settings.printerName || DEFAULT_PRINTER_NAME;
  const config = qz.configs.create(printerName);
  const data = buildThermalReceipt(transaction, settings);

  await qz.print(config, data);
}

export async function printTestReceiptQz(settings = {}) {
  const testTransaction = {
    code: "TEST-PRINT-QZ",
    date: new Date().toISOString(),
    paymentMethod: "Cash",
    subtotal: 10000,
    discount: 0,
    total: 10000,
    cashReceived: 10000,
    change: 0,
    items: [
      {
        name: "TEST PRINT THERMAL",
        qty: 1,
        price: 10000,
        subtotal: 10000,
      },
    ],
  };

  await printThermalReceiptQz(testTransaction, settings);
}