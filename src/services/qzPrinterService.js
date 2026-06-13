import * as qz from "qz-tray";

const DEFAULT_PRINTER_NAME = "EPPOS";
const RECEIPT_WIDTH = 30;

function money(value) {
  return Number(value || 0).toLocaleString("id-ID");
}

function centerText(text, width) {
  const safeWidth = width || RECEIPT_WIDTH;
  const safeText = String(text || "").trim();

  if (safeText.length >= safeWidth) {
    return safeText.slice(0, safeWidth);
  }

  const leftPadding = Math.floor((safeWidth - safeText.length) / 2);
  return " ".repeat(leftPadding) + safeText;
}

function line(char) {
  return String(char || "-").repeat(RECEIPT_WIDTH);
}

function padLine(left, right, width) {
  const safeWidth = width || RECEIPT_WIDTH;
  const safeLeft = String(left || "");
  const safeRight = String(right || "");
  const space = safeWidth - safeLeft.length - safeRight.length;

  if (space <= 1) {
    return safeLeft.slice(0, safeWidth - safeRight.length - 1) + " " + safeRight;
  }

  return safeLeft + " ".repeat(space) + safeRight;
}

function wrapText(text, maxLength) {
  const safeMaxLength = maxLength || RECEIPT_WIDTH;
  const words = String(text || "").split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? currentLine + " " + word : word;

    if (nextLine.length > safeMaxLength) {
      if (currentLine) {
        lines.push(currentLine);
      }

      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

export function buildThermalReceipt(transaction, settings) {
  const safeSettings = settings || {};
  const storeName = safeSettings.storeName || "Toko Telon Mindi";
  const address = safeSettings.address || "";
  const phone = safeSettings.phone || "";
  const receiptNote = safeSettings.receiptNote || "Terima kasih sudah belanja.";

  const receiptLines = [];

  receiptLines.push(centerText(storeName.toUpperCase()));

  if (address) {
    wrapText(address).forEach(function (text) {
      receiptLines.push(centerText(text));
    });
  }

  if (phone) {
    receiptLines.push(centerText("WA: " + phone));
  }

  receiptLines.push(line());
  receiptLines.push("No: " + (transaction.code || "-"));
  receiptLines.push(
    "Tgl: " +
      new Date(transaction.date).toLocaleString("id-ID", {
        dateStyle: "short",
        timeStyle: "short",
      })
  );
  receiptLines.push("Bayar: " + (transaction.paymentMethod || "Cash"));
  receiptLines.push(line());

  transaction.items.forEach(function (item) {
  const itemNameLines = wrapText(item.name, RECEIPT_WIDTH);

  itemNameLines.forEach(function (text) {
    receiptLines.push(text);
  });

  receiptLines.push(
    padLine(
      String(item.qty || 0) + " x " + money(item.price),
      money(item.subtotal)
    )
  );

  if (item.variantName) {
    receiptLines.push("Varian: " + item.variantName);
  }
});

  receiptLines.push(line());
  receiptLines.push(padLine("Subtotal", money(transaction.subtotal)));
  receiptLines.push(padLine("Diskon", money(transaction.discount)));
  receiptLines.push(padLine("TOTAL", money(transaction.total)));
  receiptLines.push(padLine("Tunai", money(transaction.cashReceived)));
  receiptLines.push(padLine("Kembali", money(transaction.change)));
  receiptLines.push(line());

  if (receiptNote) {
    wrapText(receiptNote).forEach(function (text) {
      receiptLines.push(centerText(text));
    });
  }

  receiptLines.push("");
  receiptLines.push("");
  receiptLines.push("");

  return [
    {
      type: "raw",
      format: "plain",
      data: receiptLines.join("\n"),
    },
  ];
}

export async function connectQzTray() {
  if (!qz.websocket.isActive()) {
    await qz.websocket.connect();
  }
}

export async function printThermalReceiptQz(transaction, settings) {
  await connectQzTray();

  const safeSettings = settings || {};
  const printerName = safeSettings.printerName || DEFAULT_PRINTER_NAME;
  const config = qz.configs.create(printerName);
  const data = buildThermalReceipt(transaction, safeSettings);

  await qz.print(config, data);
}

export async function printTestReceiptQz(settings) {
  const testTransaction = {
    code: "TEST-PRINT-QZ",
    date: new Date().toISOString(),
    paymentMethod: "Cash",
    subtotal: 1000,
    discount: 0,
    total: 1000,
    cashReceived: 1000,
    change: 0,
    items: [
      {
        id: "test",
        name: "TEST PRINT THERMAL",
        qty: 1,
        price: 1000,
        subtotal: 1000,
      },
    ],
  };

  await printThermalReceiptQz(testTransaction, settings || {});
}