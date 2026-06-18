import { useEffect, useMemo, useState } from "react";
import "./App.css";
import "./styles/index.css";
import { formatRupiah } from "./lib/format";
import {
  fetchProductsFromSupabase,
  fetchProductVariantsFromSupabase,
  fetchStockBatchesFromSupabase,
  fetchStoreSettingsFromSupabase,
  updateStoreSettingsInSupabase,
  createTransactionInSupabase,
  cancelTransactionInSupabase,
  updateStockBatchesInSupabase,
  fetchTransactionsFromSupabase,
  updateUsedStockBatchesInSupabase,
  createProductInSupabase,
  updateProductInSupabase,
  createProductVariantInSupabase,
  updateProductVariantInSupabase,
  createStockBatchInSupabase,
  fetchCurrentProfileFromSupabase,
  saveCashierSessionToSupabase,
  fetchOpenCashierSessionFromSupabase,
  fetchCashFlowsBySessionFromSupabase,
  createCashFlowInSupabase,
  createCashierClosingInSupabase,
  fetchCashierClosingsFromSupabase,
} from "./services/supabaseDataService";
import { supabase } from "./lib/supabaseClient";
import {
  printThermalReceiptQz,
  printTestReceiptQz,
} from "./services/qzPrinterService";

const TRANSACTIONS_STORAGE_KEY = "ttm_pos_transactions";
const STOCK_BATCHES_STORAGE_KEY = "ttm_pos_stock_batches";
const PRODUCTS_STORAGE_KEY = "ttm_pos_products";
const PRODUCT_VARIANTS_STORAGE_KEY = "ttm_pos_product_variants";
const SETTINGS_STORAGE_KEY = "ttm_pos_settings";
const CASHIER_CLOSINGS_STORAGE_KEY = "ttm_cashier_closings";

const defaultSettings = {
  storeName: "Toko Telon Mindi",
  address: "",
  phone: "",
  receiptNote: "Terima kasih sudah belanja.",
  lowStockThreshold: 10,
  autoLoadSupabase: true,
  printerName: "EPPOS",
};

const pinLoginUsers = {
  admin: {
    label: "Admin",
    email: import.meta.env.VITE_ADMIN_LOGIN_EMAIL || "",
    password: import.meta.env.VITE_ADMIN_LOGIN_PASSWORD || "",
    pin: import.meta.env.VITE_ADMIN_LOGIN_PIN || "",
  },
  cashier: {
    label: "Kasir",
    email: import.meta.env.VITE_CASHIER_LOGIN_EMAIL || "",
    password: import.meta.env.VITE_CASHIER_LOGIN_PASSWORD || "",
    pin: import.meta.env.VITE_CASHIER_LOGIN_PIN || "",
  },
};

function createTransactionCode() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  const millisecond = String(now.getMilliseconds()).padStart(3, "0");

  return (
    "TRX-" +
    year +
    month +
    day +
    "-" +
    hour +
    minute +
    second +
    millisecond
  );
}

function getProductStockFromBatches(productId, stockBatches) {
  return stockBatches
    .filter((batch) => batch.productId === productId)
    .reduce((total, batch) => total + Number(batch.qtyRemaining || 0), 0);
}

function processFifoSale(cartItems, stockBatches) {
  const updatedBatches = stockBatches.map((batch) => ({ ...batch }));
  const fifoResultItems = [];

  for (const cartItem of cartItems) {
    const saleQty = Number(cartItem.qty || 0);
    const qtyMultiplier = Number(cartItem.qtyMultiplier || 1);
    const fifoQtyToSell = saleQty * qtyMultiplier;

    let remainingQtyToSell = fifoQtyToSell;

    const productBatches = updatedBatches
      .filter(
        (batch) =>
          batch.productId === cartItem.id &&
          Number(batch.qtyRemaining || 0) > 0
      )
      .sort((a, b) => {
        const dateA = new Date(a.purchaseDate).getTime();
        const dateB = new Date(b.purchaseDate).getTime();

        if (dateA !== dateB) {
          return dateA - dateB;
        }

        return Number(a.id) - Number(b.id);
      });

    const totalAvailableStock = productBatches.reduce(
      (total, batch) => total + Number(batch.qtyRemaining || 0),
      0
    );

    if (totalAvailableStock < remainingQtyToSell) {
      return {
        success: false,
        message:
          "Stok produk " +
          cartItem.name +
          " tidak cukup. Stok tersedia " +
          totalAvailableStock +
          ", diminta " +
          remainingQtyToSell +
          ".",
      };
    }

    const usedBatches = [];

    for (const batch of productBatches) {
      if (remainingQtyToSell <= 0) {
        break;
      }

      const availableQty = Number(batch.qtyRemaining || 0);
      const takenQty = Math.min(availableQty, remainingQtyToSell);
      const cost = Number(batch.cost || 0);

      batch.qtyRemaining = availableQty - takenQty;
      remainingQtyToSell = remainingQtyToSell - takenQty;

      usedBatches.push({
        batchId: batch.id,
        batchCode: batch.batchCode,
        purchaseDate: batch.purchaseDate,
        qty: takenQty,
        cost: cost,
        totalCost: takenQty * cost,
      });
    }

    const totalCost = usedBatches.reduce(
      (total, batch) => total + batch.totalCost,
      0
    );

    const subtotal = Number(cartItem.price || 0) * saleQty;

    fifoResultItems.push({
      ...cartItem,
      qty: saleQty,
      qtyMultiplier: qtyMultiplier,
      fifoQty: fifoQtyToSell,
      subtotal: subtotal,
      fifoBatches: usedBatches,
      totalCost: totalCost,
      profit: subtotal - totalCost,
    });
  }

  return {
    success: true,
    updatedBatches: updatedBatches,
    items: fifoResultItems,
  };
}

function createStockBatchCode(existingBatches) {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const dateCode = String(year) + month + day;
  const prefix = "BATCH-" + dateCode + "-";

  const todayBatches = existingBatches.filter((batch) =>
    batch.batchCode.startsWith(prefix)
  );

  const nextNumber = todayBatches.length + 1;
  const sequence = String(nextNumber).padStart(4, "0");

  return prefix + sequence;
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");
  const escapedValue = stringValue.replace(/"/g, '""');

  return '"' + escapedValue + '"';
}

function downloadCsvFile(filename, rows) {
  const csvContent = rows
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function formatWhatsAppNumber(phone) {
  if (!phone) {
    return "";
  }

  const cleanedPhone = String(phone).replace(/\D/g, "");

  if (!cleanedPhone) {
    return "";
  }

  if (cleanedPhone.startsWith("62")) {
    return "+" + cleanedPhone;
  }

  if (cleanedPhone.startsWith("0")) {
    return "+62" + cleanedPhone.slice(1);
  }

  return "+62" + cleanedPhone;
}

function mapSupabaseProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    price: Number(product.price || 0),
    cost: Number(product.cost || 0),
    unit: product.unit,
    active: product.active,
  };
}

function mapSupabaseProductVariant(variant) {
  return {
    id: variant.id,
    productId: variant.product_id,
    name: variant.name,
    qtyMultiplier: Number(variant.qty_multiplier || 1),
    price: Number(variant.price || 0),
    active: variant.active,
  };
}

function mapSupabaseStockBatch(batch) {
  return {
    id: batch.id,
    productId: batch.product_id,
    batchCode: batch.batch_code,
    purchaseDate: batch.purchase_date,
    qtyInitial: Number(batch.qty_initial || 0),
    qtyRemaining: Number(batch.qty_remaining || 0),
    cost: Number(batch.cost || 0),
  };
}

function mapSupabaseSettings(settings) {
  return {
    storeName: settings.store_name || defaultSettings.storeName,
    address: settings.address || "",
    phone: settings.phone || "",
    receiptNote: settings.receipt_note || defaultSettings.receiptNote,
    lowStockThreshold: Number(
      settings.low_stock_threshold || defaultSettings.lowStockThreshold
    ),
    autoLoadSupabase: true,
  };
}

function mapSupabaseCashierClosing(closing) {
  return {
    id: closing.id,
    cashierSessionId: closing.cashier_session_id,
    openedAt: closing.opened_at,
    closedAt: closing.closed_at,
    openingCash: Number(closing.opening_cash || 0),
    salesTotal: Number(closing.sales_total || 0),
    cashInTotal: Number(closing.cash_in_total || 0),
    cashOutTotal: Number(closing.cash_out_total || 0),
    discountTotal: Number(closing.discount_total || 0),
    profitTotal: Number(closing.profit_total || 0),
    transactionCount: Number(closing.transaction_count || 0),
    estimatedClosingCash: Number(closing.estimated_closing_cash || 0),
    actualClosingCash: Number(closing.actual_closing_cash || 0),
    difference: Number(closing.difference || 0),
    status: closing.status || "Belum dicek",
  };
}

function mapSupabaseCashierSession(session) {
  return {
    id: session.id,
    isOpen: session.is_open === true,
    openedAt: session.opened_at,
    closedAt: session.closed_at,
    openingCash: Number(session.opening_cash || 0),
    cashIn: [],
    cashOut: [],
  };
}

function mapSupabaseCashFlow(cashFlow) {
  return {
    id: cashFlow.id,
    cashierSessionId: cashFlow.cashier_session_id,
    type: cashFlow.type,
    note: cashFlow.note,
    amount: Number(cashFlow.amount || 0),
    createdAt: cashFlow.created_at,
  };
}

function App() {
  const [activePage, setActivePage] = useState("cashier");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [selectedLoginRole, setSelectedLoginRole] = useState("cashier");
  const [loginPin, setLoginPin] = useState("");
  const [currentProfile, setCurrentProfile] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState("idle");
  const [products, setProducts] = useState(() => {
    const savedProducts = localStorage.getItem(PRODUCTS_STORAGE_KEY);

  if (!savedProducts) {
  return [];
}

try {
  return JSON.parse(savedProducts);
} catch {
  return [];
}
  });

  const [productVariants, setProductVariants] = useState(() => {
  const savedVariants = localStorage.getItem(PRODUCT_VARIANTS_STORAGE_KEY);

  if (!savedVariants) {
  return [];
}

try {
  return JSON.parse(savedVariants);
} catch {
  return [];
}
});

  const [settings, setSettings] = useState(() => {
  const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);

  if (!savedSettings) {
    return defaultSettings;
  }

  try {
    return {
      ...defaultSettings,
      ...JSON.parse(savedSettings),
    };
  } catch {
    return defaultSettings;
  }
});

  const [stockBatches, setStockBatches] = useState(() => {
  const savedStockBatches = localStorage.getItem(STOCK_BATCHES_STORAGE_KEY);

  if (!savedStockBatches) {
  return [];
}

try {
  return JSON.parse(savedStockBatches);
} catch {
  return [];
}
});

  const [transactions, setTransactions] = useState(() => {
    const savedTransactions = localStorage.getItem(TRANSACTIONS_STORAGE_KEY);

    if (!savedTransactions) { 
      return []; 
    }

    try {
      return JSON.parse(savedTransactions);
    } catch {
      return [];
    }
});

  const unsyncedTransactionCount = transactions.filter(
  (transaction) =>
    transaction.syncStatus === "failed" || transaction.syncStatus === "pending"
).length;

  const currentRole = currentProfile ? currentProfile.role : "cashier";

  const menus = [
  { id: "dashboard", label: "Dashboard", roles: ["admin", "cashier"] },
  { id: "cashier", label: "Kasir", roles: ["admin", "cashier"] },
  { id: "products", label: "Produk", roles: ["admin"] },
  { id: "inventory", label: "Stok", roles: ["admin"] },
  {
    id: "transactions",
    label: "Riwayat",
    badge: unsyncedTransactionCount,
    roles: ["admin", "cashier"],
  },
  { id: "reports", label: "Laporan", roles: ["admin"] },
  { id: "settings", label: "Pengaturan", roles: ["admin"] },
].filter((menu) => menu.roles.includes(currentRole));

  const activeMenu = menus.find((menu) => menu.id === activePage);
  const pageTitle = activeMenu ? activeMenu.label : "Kasir";

  const [currentTime, setCurrentTime] = useState(new Date());

useEffect(() => {
  const timer = setInterval(() => {
    setCurrentTime(new Date());
  }, 1000);

  return () => clearInterval(timer);
}, []);

const todayLabel = currentTime.toLocaleString("id-ID", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Jakarta",
});

  const supabaseStatusLabel =
  supabaseStatus === "connected"
    ? "Supabase Terhubung"
    : supabaseStatus === "checking"
      ? "Cek Supabase..."
      : supabaseStatus === "failed"
        ? "Supabase Gagal"
        : "Supabase Belum Dites";

  const autoSyncLabel =
  unsyncedTransactionCount > 0
    ? "Auto Sync: " + unsyncedTransactionCount + " menunggu"
    : "Auto Sync Aktif";

const [cashierSession, setCashierSession] = useState({
  id: null,
  isOpen: false,
  openedAt: null,
  closedAt: null,
  openingCash: 0,
  cashIn: [],
  cashOut: [],
});
const [isCloseCashierPreviewOpen, setIsCloseCashierPreviewOpen] = useState(false);
const [actualClosingCash, setActualClosingCash] = useState("");
const [cashFlowModalType, setCashFlowModalType] = useState(null);
const [cashFlowNote, setCashFlowNote] = useState("");
const [cashFlowAmount, setCashFlowAmount] = useState("");
const [isOpenCashierModalOpen, setIsOpenCashierModalOpen] = useState(false);
const [openingCashInput, setOpeningCashInput] = useState("");
const [cashierClosings, setCashierClosings] = useState(() => {
  const savedClosings = localStorage.getItem(CASHIER_CLOSINGS_STORAGE_KEY);

  if (!savedClosings) {
    return [];
  }

  try {
    return JSON.parse(savedClosings);
  } catch {
    return [];
  }
});


  useEffect(() => {
    localStorage.setItem(
      TRANSACTIONS_STORAGE_KEY, 
      JSON.stringify(transactions)
    );
  }, [transactions]);

  useEffect(() => {
  localStorage.setItem(
    STOCK_BATCHES_STORAGE_KEY,
    JSON.stringify(stockBatches)
  );
}, [stockBatches]);

useEffect(() => {
  localStorage.setItem(
    PRODUCTS_STORAGE_KEY,
    JSON.stringify(products)
  );
}, [products]);

useEffect(() => {
  localStorage.setItem(
    PRODUCT_VARIANTS_STORAGE_KEY,
    JSON.stringify(productVariants)
  );
}, [productVariants]);

useEffect(() => {
  localStorage.setItem(
    SETTINGS_STORAGE_KEY,
    JSON.stringify(settings)
  );
}, [settings]);

useEffect(() => {
  if (isUnlocked === true && settings.autoLoadSupabase === true) {
    loadAllDataFromSupabaseSilently();
  }
}, [isUnlocked]);

useEffect(() => {
  if (isUnlocked !== true) {
    return;
  }

  function refreshOnlineData() {
    loadAllDataFromSupabaseSilently();
  }

  window.addEventListener("focus", refreshOnlineData);

  const refreshInterval = setInterval(() => {
    refreshOnlineData();
  }, 30000);

  return () => {
    window.removeEventListener("focus", refreshOnlineData);
    clearInterval(refreshInterval);
  };
}, [isUnlocked]);

useEffect(() => {
  function handleOnline() {
    setIsOnline(true);
    retryFailedTransactionSync(false);
  }

  function handleOffline() {
    setIsOnline(false);
  }

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);

  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
}, [transactions, stockBatches]);

useEffect(() => {
  if (menus.length === 0) {
    return;
  }

  const canAccessCurrentPage = menus.some((menu) => menu.id === activePage);

  if (canAccessCurrentPage === false) {
    setActivePage("cashier");
  }
}, [currentRole, activePage]);

useEffect(() => {
  localStorage.setItem(
    CASHIER_CLOSINGS_STORAGE_KEY,
    JSON.stringify(cashierClosings)
  );
}, [cashierClosings]);

async function submitLogin(event) {
  event.preventDefault();

  const loginUser = pinLoginUsers[selectedLoginRole];

  if (!loginUser) {
    alert("Pilih user login terlebih dahulu.");
    return;
  }

  if (!loginUser.email || !loginUser.password || !loginUser.pin) {
    alert("Konfigurasi login PIN belum lengkap. Cek file .env.local.");
    return;
  }

  if (!loginPin.trim()) {
    alert("PIN wajib diisi.");
    return;
  }

  if (loginPin.trim() !== loginUser.pin) {
    alert("PIN salah.");
    setLoginPin("");
    return;
  }

  setIsAuthLoading(true);

  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginUser.email,
    password: loginUser.password,
  });

  if (error) {
    setIsAuthLoading(false);
    alert("Login gagal: " + error.message);
    return;
  }

  try {
    const profile = await fetchCurrentProfileFromSupabase(data.user.id);

    if (profile.active !== true) {
      await supabase.auth.signOut();
      setIsAuthLoading(false);
      alert("Akun ini tidak aktif.");
      return;
    }

    if (profile.role !== selectedLoginRole) {
      await supabase.auth.signOut();
      setIsAuthLoading(false);
      setLoginPin("");
      alert("Role akun tidak sesuai dengan tombol login yang dipilih.");
      return;
    }

    setCurrentProfile(profile);
    setIsUnlocked(true);
    setLoginPin("");

    if (profile.role === "admin") {
      setActivePage("dashboard");
    } else {
      setActivePage("dashboard");
    }
  } catch (profileError) {
    await supabase.auth.signOut();
    alert("Gagal membaca role user: " + profileError.message);
  }

  setIsAuthLoading(false);
}

function reduceProductStock(cartItems) {
  setProducts((currentProducts) =>
    currentProducts.map((product) => {
      const soldItem = cartItems.find((item) => item.id === product.id);

      if (!soldItem) {
        return product;
      }

      return {
        ...product,
        stock: Math.max(Number(product.stock || 0) - Number(soldItem.qty || 0), 0),
      };
    })
  );
}

function clearTransactions() {
  const confirmClear = window.confirm(
    "Hapus riwayat transaksi lokal di browser ini? Stok FIFO, produk, varian, pengaturan, dan data Supabase tidak akan dihapus."
  );

  if (confirmClear === false) {
    return;
  }

  setTransactions([]);
  localStorage.removeItem(TRANSACTIONS_STORAGE_KEY);

  alert("Riwayat transaksi lokal berhasil dihapus. Stok dan data produk tetap aman.");
}

async function addProduct(newProduct) {
  setProducts((currentProducts) => [
    ...currentProducts,
    newProduct,
  ]);

  try {
    await createProductInSupabase(newProduct);
  } catch (error) {
    console.error(error);
    alert("Produk tersimpan lokal, tapi gagal masuk Supabase: " + error.message);
  }
}

async function updateProduct(updatedProduct) {
  setProducts((currentProducts) =>
    currentProducts.map((product) =>
      product.id === updatedProduct.id ? updatedProduct : product
    )
  );

  try {
    await updateProductInSupabase(updatedProduct);
  } catch (error) {
    console.error(error);
    alert("Produk tersimpan lokal, tapi gagal update Supabase: " + error.message);
  }
}

async function deactivateProduct(productId) {
  const confirmDeactivate = window.confirm(
    "Nonaktifkan produk ini? Produk tidak akan muncul di kasir."
  );

  if (confirmDeactivate === false) {
    return;
  }

  const productToUpdate = products.find((product) => product.id === productId);

  if (!productToUpdate) {
    return;
  }

  const updatedProduct = {
    ...productToUpdate,
    active: false,
  };

  setProducts((currentProducts) =>
    currentProducts.map((product) =>
      product.id === productId ? updatedProduct : product
    )
  );

  try {
    await updateProductInSupabase(updatedProduct);
  } catch (error) {
    console.error(error);
    alert("Produk dinonaktifkan lokal, tapi gagal update Supabase: " + error.message);
  }
}

async function activateProduct(productId) {
  const productToUpdate = products.find((product) => product.id === productId);

  if (!productToUpdate) {
    return;
  }

  const updatedProduct = {
    ...productToUpdate,
    active: true,
  };

  setProducts((currentProducts) =>
    currentProducts.map((product) =>
      product.id === productId ? updatedProduct : product
    )
  );

  try {
    await updateProductInSupabase(updatedProduct);
  } catch (error) {
    console.error(error);
    alert("Produk diaktifkan lokal, tapi gagal update Supabase: " + error.message);
  }
}

async function addProductVariant(newVariant) {
  setProductVariants((currentVariants) => [
    ...currentVariants,
    newVariant,
  ]);

  try {
    await createProductVariantInSupabase(newVariant);
  } catch (error) {
    console.error(error);
    alert("Varian tersimpan lokal, tapi gagal masuk Supabase: " + error.message);
  }
}

async function updateProductVariant(updatedVariant) {
  setProductVariants((currentVariants) =>
    currentVariants.map((variant) =>
      variant.id === updatedVariant.id ? updatedVariant : variant
    )
  );

  try {
    await updateProductVariantInSupabase(updatedVariant);
  } catch (error) {
    console.error(error);
    alert("Varian tersimpan lokal, tapi gagal update Supabase: " + error.message);
  }
}

async function deactivateProductVariant(variantId) {
  const confirmDeactivate = window.confirm(
    "Nonaktifkan varian ini? Varian tidak akan muncul di kasir."
  );

  if (confirmDeactivate === false) {
    return;
  }

  const variantToUpdate = productVariants.find(
    (variant) => variant.id === variantId
  );

  if (!variantToUpdate) {
    return;
  }

  const updatedVariant = {
    ...variantToUpdate,
    active: false,
  };

  setProductVariants((currentVariants) =>
    currentVariants.map((variant) =>
      variant.id === variantId ? updatedVariant : variant
    )
  );

  try {
    await updateProductVariantInSupabase(updatedVariant);
  } catch (error) {
    console.error(error);
    alert("Varian dinonaktifkan lokal, tapi gagal update Supabase: " + error.message);
  }
}

async function activateProductVariant(variantId) {
  const variantToUpdate = productVariants.find(
    (variant) => variant.id === variantId
  );

  if (!variantToUpdate) {
    return;
  }

  const updatedVariant = {
    ...variantToUpdate,
    active: true,
  };

  setProductVariants((currentVariants) =>
    currentVariants.map((variant) =>
      variant.id === variantId ? updatedVariant : variant
    )
  );

  try {
    await updateProductVariantInSupabase(updatedVariant);
  } catch (error) {
    console.error(error);
    alert("Varian diaktifkan lokal, tapi gagal update Supabase: " + error.message);
  }
}

async function addStockBatch(newBatch) {
  setStockBatches((currentBatches) => [
    ...currentBatches,
    newBatch,
  ]);

  try {
    await createStockBatchInSupabase(newBatch);
  } catch (error) {
    console.error(error);
    alert("Batch stok tersimpan lokal, tapi gagal masuk Supabase: " + error.message);
  }
}

function mapSupabaseTransaction(transaction) {
  const items = (transaction.transaction_items || []).map((item) => ({
    cartItemId:
      String(item.product_id || item.id) +
      "-" +
      (item.variant_id ? "variant-" + item.variant_id : "default"),
    id: item.product_id,
    productId: item.product_id,
    variantId: item.variant_id,
    name: item.name,
    productName: item.product_name,
    variantName: item.variant_name,
    category: item.category,
    unit: item.unit,
    qty: Number(item.qty || 0),
    qtyMultiplier: Number(item.qty_multiplier || 1),
    fifoQty: Number(item.fifo_qty || 0),
    price: Number(item.price || 0),
    subtotal: Number(item.subtotal || 0),
    totalCost: Number(item.total_cost || 0),
    profit: Number(item.profit || 0),
    fifoBatches: (item.transaction_item_batches || []).map((batch) => ({
      batchId: batch.stock_batch_id,
      batchCode: batch.batch_code,
      purchaseDate: batch.purchase_date,
      qty: Number(batch.qty || 0),
      cost: Number(batch.cost || 0),
      totalCost: Number(batch.total_cost || 0),
    })),
  }));

  return {
  id: transaction.id,
  code: transaction.code,
  date: transaction.transaction_date,
  items: items,
  subtotal: Number(transaction.subtotal || 0),
  discount: Number(transaction.discount || 0),
  total: Number(transaction.total || 0),
  cashReceived: Number(transaction.cash_received || 0),
  change: Number(transaction.change_amount || 0),
  paymentMethod: transaction.payment_method || "Cash",
  profit: Number(transaction.profit || 0),

  status: transaction.status || "completed",

originalSubtotal: Number(transaction.original_subtotal || transaction.subtotal || 0),
originalDiscount: Number(transaction.original_discount || transaction.discount || 0),
originalTotal: Number(transaction.original_total || transaction.total || 0),
originalProfit: Number(transaction.original_profit || transaction.profit || 0),

cancelReason: transaction.cancel_reason || "",
cancelledAt: transaction.cancelled_at || "",
cancelledBy: transaction.cancelled_by || "",

  cashierName: transaction.cashier_name || "",
  cashierRole: transaction.cashier_role || "",
  paymentStatus: transaction.payment_status || "paid",
  paidAmount: Number(transaction.paid_amount || transaction.cash_received || 0),
  debtAmount: Number(transaction.debt_amount || 0),
  customerName: transaction.customer_name || "",
  customerPhone: transaction.customer_phone || "",
  debtNote: transaction.debt_note || "",
  dueDate: transaction.due_date || "",
  syncStatus: "synced"
};
}

function mergeSupabaseTransactionsWithLocalFailed(
  supabaseTransactions,
  localTransactions
) {
  const mappedSupabaseTransactions = supabaseTransactions.map(mapSupabaseTransaction);

  const unsyncedLocalTransactions = localTransactions.filter(
    (transaction) =>
      transaction.syncStatus === "failed" || transaction.syncStatus === "pending"
  );

  const supabaseCodes = new Set(
    mappedSupabaseTransactions.map((transaction) => transaction.code)
  );

  const localOnlyUnsyncedTransactions = unsyncedLocalTransactions.filter(
    (transaction) => supabaseCodes.has(transaction.code) === false
  );

  return [...localOnlyUnsyncedTransactions, ...mappedSupabaseTransactions];
}

function applyUnsyncedTransactionsToStockBatches(stockBatches, localTransactions) {
  const updatedBatches = stockBatches.map((batch) => ({ ...batch }));

  const unsyncedTransactions = localTransactions.filter(
    (transaction) =>
      transaction.syncStatus === "failed" || transaction.syncStatus === "pending"
  );

  unsyncedTransactions.forEach((transaction) => {
    transaction.items.forEach((item) => {
      if (!Array.isArray(item.fifoBatches)) {
        return;
      }

      item.fifoBatches.forEach((fifoBatch) => {
        const batchIndex = updatedBatches.findIndex(
          (batch) => batch.id === fifoBatch.batchId
        );

        if (batchIndex === -1) {
          return;
        }

        const currentQty = Number(updatedBatches[batchIndex].qtyRemaining || 0);
        const usedQty = Number(fifoBatch.qty || 0);

        updatedBatches[batchIndex] = {
          ...updatedBatches[batchIndex],
          qtyRemaining: Math.max(0, currentQty - usedQty),
        };
      });
    });
  });

  return updatedBatches;
}

async function addTransaction(transaction, updatedBatches) {
  const localTransaction = {
    ...transaction,
    syncStatus: "pending",
  };

  setTransactions((currentTransactions) => [
    localTransaction,
    ...currentTransactions,
  ]);

  setStockBatches(updatedBatches);

  try {
    await createTransactionInSupabase(transaction);
    await updateUsedStockBatchesInSupabase(transaction, updatedBatches);

    setTransactions((currentTransactions) =>
      currentTransactions.map((currentTransaction) =>
        currentTransaction.id === transaction.id
          ? {
              ...currentTransaction,
              syncStatus: "synced",
            }
          : currentTransaction
      )
    );
  } catch (error) {
    console.error(error);

    setTransactions((currentTransactions) =>
      currentTransactions.map((currentTransaction) =>
        currentTransaction.id === transaction.id
          ? {
              ...currentTransaction,
              syncStatus: "failed",
              syncError: error.message,
            }
          : currentTransaction
      )
    );

    alert(
      "Transaksi tersimpan lokal, tapi gagal sinkron ke Supabase: " +
        error.message
    );
  }
}

function restoreStockFromCancelledTransaction(transaction, currentStockBatches) {
  const restoredBatches = currentStockBatches.map((batch) => ({ ...batch }));

  transaction.items.forEach((item) => {
    if (!Array.isArray(item.fifoBatches)) {
      return;
    }

    item.fifoBatches.forEach((fifoBatch) => {
      const batchIndex = restoredBatches.findIndex(
        (batch) => Number(batch.id) === Number(fifoBatch.batchId)
      );

      if (batchIndex === -1) {
        return;
      }

      restoredBatches[batchIndex] = {
        ...restoredBatches[batchIndex],
        qtyRemaining:
          Number(restoredBatches[batchIndex].qtyRemaining || 0) +
          Number(fifoBatch.qty || 0),
      };
    });
  });

  return restoredBatches;
}

async function cancelTransaction(transaction, reason) {
  if (currentRole !== "admin") {
    alert("Hanya admin yang bisa membatalkan transaksi.");
    return false;
  }

  if (!transaction) {
    alert("Transaksi tidak ditemukan.");
    return false;
  }

  if (transaction.status === "cancelled") {
    alert("Transaksi ini sudah dibatalkan.");
    return false;
  }

  const cleanReason = String(reason || "").trim();

  if (!cleanReason) {
    alert("Alasan pembatalan wajib diisi.");
    return false;
  }

  const confirmCancel = window.confirm(
    "Batalkan transaksi " +
      transaction.code +
      "?\n\nStok FIFO akan dikembalikan dan omzet transaksi ini tidak dihitung."
  );

  if (confirmCancel === false) {
    return false;
  }

  const cancelledAt = new Date().toISOString();
  const cancelledBy =
    currentProfile?.name ||
    currentProfile?.email ||
    currentProfile?.role ||
    "Admin";

  const cancelledTransaction = {
    ...transaction,

    status: "cancelled",

    originalSubtotal: Number(transaction.originalSubtotal ?? transaction.subtotal ?? 0),
    originalDiscount: Number(transaction.originalDiscount ?? transaction.discount ?? 0),
    originalTotal: Number(transaction.originalTotal ?? transaction.total ?? 0),
    originalProfit: Number(transaction.originalProfit ?? transaction.profit ?? 0),

    subtotal: 0,
    discount: 0,
    total: 0,
    cashReceived: 0,
    change: 0,
    profit: 0,

    paymentStatus: "cancelled",
    cancelReason: cleanReason,
    cancelledAt: cancelledAt,
    cancelledBy: cancelledBy,
    syncStatus: "pending",
    syncError: "",
  };

  const restoredBatches = restoreStockFromCancelledTransaction(
    transaction,
    stockBatches
  );

  setTransactions((currentTransactions) =>
    currentTransactions.map((currentTransaction) =>
      currentTransaction.code === transaction.code
        ? cancelledTransaction
        : currentTransaction
    )
  );

  setStockBatches(restoredBatches);

  try {
    await cancelTransactionInSupabase(cancelledTransaction);
    await updateStockBatchesInSupabase(restoredBatches);

    setTransactions((currentTransactions) =>
      currentTransactions.map((currentTransaction) =>
        currentTransaction.code === transaction.code
          ? {
              ...cancelledTransaction,
              syncStatus: "synced",
              syncError: "",
            }
          : currentTransaction
      )
    );

    alert("Transaksi berhasil dibatalkan dan stok FIFO sudah dikembalikan.");
    return true;
  } catch (error) {
    console.error(error);

    setTransactions((currentTransactions) =>
      currentTransactions.map((currentTransaction) =>
        currentTransaction.code === transaction.code
          ? {
              ...cancelledTransaction,
              syncStatus: "failed",
              syncError: error.message,
            }
          : currentTransaction
      )
    );

    alert(
      "Transaksi dibatalkan lokal, tapi gagal sinkron ke Supabase: " +
        error.message
    );

    return true;
  }
}

async function testSupabaseConnection() {
  setSupabaseStatus("checking");

  try {
    const supabaseProducts = await fetchProductsFromSupabase();
    const supabaseProductVariants = await fetchProductVariantsFromSupabase();
    const supabaseStockBatches = await fetchStockBatchesFromSupabase();
    const supabaseSettings = await fetchStoreSettingsFromSupabase();

    setSupabaseStatus("connected");

    alert(
      "Supabase terkoneksi.\n\n" +
        "Products: " +
        supabaseProducts.length +
        "\nVariants: " +
        supabaseProductVariants.length +
        "\nStock Batches: " +
        supabaseStockBatches.length +
        "\nSettings: " +
        (supabaseSettings ? "ada" : "tidak ada")
    );
  } catch (error) {
    console.error(error);
    setSupabaseStatus("failed");
    alert("Gagal konek ke Supabase: " + error.message);
  }
}

async function loadAllDataFromSupabaseSilently() {
  try {
    const supabaseProducts = await fetchProductsFromSupabase();
    const supabaseProductVariants = await fetchProductVariantsFromSupabase();
    const supabaseStockBatches = await fetchStockBatchesFromSupabase();
    const supabaseSettings = await fetchStoreSettingsFromSupabase();
    const supabaseTransactions = await fetchTransactionsFromSupabase();
    const supabaseCashierClosings = await fetchCashierClosingsFromSupabase();
    const supabaseOpenSession = await fetchOpenCashierSessionFromSupabase();

    setProducts(supabaseProducts.map(mapSupabaseProduct));
    setProductVariants(supabaseProductVariants.map(mapSupabaseProductVariant));

    setTransactions((currentTransactions) =>
      mergeSupabaseTransactionsWithLocalFailed(
        supabaseTransactions,
        currentTransactions
      )
    );

    setCashierClosings(
  supabaseCashierClosings.map(mapSupabaseCashierClosing)
);

    if (supabaseOpenSession) {
  const supabaseCashFlows = await fetchCashFlowsBySessionFromSupabase(
    supabaseOpenSession.id
  );

  const mappedCashFlows = supabaseCashFlows.map(mapSupabaseCashFlow);

  setCashierSession({
    ...mapSupabaseCashierSession(supabaseOpenSession),
    cashIn: mappedCashFlows.filter((flow) => flow.type === "in"),
    cashOut: mappedCashFlows.filter((flow) => flow.type === "out"),
  });
} else {
  setCashierSession({
    id: null,
    isOpen: false,
    openedAt: null,
    closedAt: null,
    openingCash: 0,
    cashIn: [],
    cashOut: [],
  });
}

    setStockBatches((currentStockBatches) => {
      const mappedSupabaseStockBatches = supabaseStockBatches.map(
        mapSupabaseStockBatch
      );

      return applyUnsyncedTransactionsToStockBatches(
        mappedSupabaseStockBatches,
        transactions
      );
    });

    if (supabaseSettings) {
      setSettings((currentSettings) => ({
        ...currentSettings,
        ...mapSupabaseSettings(supabaseSettings),
        autoLoadSupabase: true,
      }));
    }

    setSupabaseStatus("connected");
  } catch (error) {
    console.error("Gagal auto load Supabase:", error);
    setSupabaseStatus("failed");
  }
}

async function refreshAllDataFromSupabase() {
  const confirmRefresh = window.confirm(
    "Refresh data online dari Supabase? Data aplikasi akan diperbarui dari database online."
  );

  if (confirmRefresh === false) {
    return;
  }

  await loadAllDataFromSupabaseSilently();

  alert("Data online berhasil direfresh.");
}

async function retryFailedTransactionSync(showAlert = true) {
  const unsyncedTransactions = transactions.filter(
    (transaction) =>
      transaction.syncStatus === "failed" || transaction.syncStatus === "pending"
  );

  if (unsyncedTransactions.length === 0) {
    if (showAlert) {
    alert("Tidak ada transaksi gagal/pending untuk disinkron ulang.");
    }
    
    return;
  }

  if (showAlert) {
  const confirmRetry = window.confirm(
    "Sinkron ulang " +
      unsyncedTransactions.length +
      " transaksi gagal/pending ke Supabase?"
  );

  if (confirmRetry === false) {
    return;
  }
}

  let successCount = 0;
  let failedCount = 0;

  for (const transaction of unsyncedTransactions) {
    try {
      await createTransactionInSupabase(transaction);
      await updateUsedStockBatchesInSupabase(transaction, stockBatches);

      successCount += 1;

      setTransactions((currentTransactions) =>
        currentTransactions.map((currentTransaction) =>
          currentTransaction.id === transaction.id
            ? {
                ...currentTransaction,
                syncStatus: "synced",
                syncError: "",
              }
            : currentTransaction
        )
      );
    } catch (error) {
      failedCount += 1;

      setTransactions((currentTransactions) =>
        currentTransactions.map((currentTransaction) =>
          currentTransaction.id === transaction.id
            ? {
                ...currentTransaction,
                syncStatus: "failed",
                syncError: error.message,
              }
            : currentTransaction
        )
      );

      console.error("Gagal sinkron ulang transaksi:", error);
    }
  }

  if (showAlert) {
  alert(
    "Sinkron ulang selesai.\n\n" +
      "Berhasil: " +
      successCount +
      "\nGagal: " +
      failedCount
  );
}
}

async function syncLocalStockBatchesToSupabase() {
  const syncConfirmation = window.prompt(
  "Sinkron stok FIFO lokal ke Supabase akan menyamakan qty batch online dengan data lokal.\n\nKetik STOK untuk melanjutkan."
);

if (syncConfirmation !== "STOK") {
  return;
}

  try {
    await updateStockBatchesInSupabase(stockBatches);

    alert("Stok FIFO lokal berhasil disinkronkan ke Supabase.");
  } catch (error) {
    console.error(error);
    alert("Gagal sinkron stok ke Supabase: " + error.message);
  }
}

async function retrySingleTransactionSync(transaction) {
  if (!transaction) {
    return;
  }

  try {
    await createTransactionInSupabase(transaction);
    await updateUsedStockBatchesInSupabase(transaction, stockBatches);

    setTransactions((currentTransactions) =>
      currentTransactions.map((currentTransaction) =>
        currentTransaction.id === transaction.id
          ? {
              ...currentTransaction,
              syncStatus: "synced",
              syncError: "",
            }
          : currentTransaction
      )
    );

    alert("Transaksi berhasil disinkronkan.");
  } catch (error) {
    console.error(error);

    setTransactions((currentTransactions) =>
      currentTransactions.map((currentTransaction) =>
        currentTransaction.id === transaction.id
          ? {
              ...currentTransaction,
              syncStatus: "failed",
              syncError: error.message,
            }
          : currentTransaction
      )
    );

    alert("Gagal sinkron ulang transaksi: " + error.message);
  }
}

async function openCashierSession(openingCashInput) {
  if (cashierSession.isOpen) {
    alert("Kasir sudah dibuka.");
    return false;
  }

  const openingCash = Number(openingCashInput || 0);

  if (!Number.isFinite(openingCash) || openingCash <= 0) {
    alert("Modal awal kasir harus lebih dari 0.");
    return false;
  }

  const openedAt = new Date().toISOString();

  const newSession = {
    id: Date.now(),
    isOpen: true,
    openedAt: openedAt,
    closedAt: null,
    openingCash: openingCash,
    cashIn: [],
    cashOut: [],
  };

  setCashierSession(newSession);

  try {
    await saveCashierSessionToSupabase(newSession);
    return true;
  } catch (error) {
    console.error(error);
    alert(
      "Kasir berhasil dibuka lokal, tapi gagal tersimpan ke Supabase: " +
        error.message
    );
    return true;
  }
}

function openOpenCashierModal() {
  if (cashierSession.isOpen) {
    alert("Kasir sudah dibuka.");
    return;
  }

  setOpeningCashInput("");
  setIsOpenCashierModalOpen(true);
}

function closeOpenCashierModal() {
  setOpeningCashInput("");
  setIsOpenCashierModalOpen(false);
}

async function submitOpenCashierModal(event) {
  event.preventDefault();

  const success = await openCashierSession(openingCashInput);

  if (success) {
    closeOpenCashierModal();
  }
}

function openCashFlowModal(type) {
  if (!cashierSession.isOpen) {
    alert("Kasir belum dibuka.");
    return;
  }

  setCashFlowModalType(type);
  setCashFlowNote("");
  setCashFlowAmount("");
}

function closeCashFlowModal() {
  setCashFlowModalType(null);
  setCashFlowNote("");
  setCashFlowAmount("");
}

async function submitCashFlow(event) {
  event.preventDefault();

  const note = cashFlowNote.trim();
  const amount = Number(cashFlowAmount || 0);

  if (!cashierSession.isOpen) {
    alert("Kasir belum dibuka.");
    return;
  }

  if (!note) {
    alert("Keterangan wajib diisi.");
    return;
  }

  if (amount <= 0) {
    alert("Nominal harus lebih dari 0.");
    return;
  }

  const newCashFlow = {
    id: Date.now(),
    cashierSessionId: cashierSession.id,
    type: cashFlowModalType,
    note: note,
    amount: amount,
    createdAt: new Date().toISOString(),
  };

  setCashierSession((currentSession) => {
    if (cashFlowModalType === "in") {
      return {
        ...currentSession,
        cashIn: [...(currentSession.cashIn || []), newCashFlow],
      };
    }

    return {
      ...currentSession,
      cashOut: [...(currentSession.cashOut || []), newCashFlow],
    };
  });

  try {
    await createCashFlowInSupabase(newCashFlow);

    alert(
      cashFlowModalType === "in"
        ? "Pemasukan berhasil dicatat dan tersimpan ke Supabase."
        : "Pengeluaran berhasil dicatat dan tersimpan ke Supabase."
    );
  } catch (error) {
    console.error(error);

    alert(
      cashFlowModalType === "in"
        ? "Pemasukan tersimpan lokal, tapi gagal masuk Supabase: " + error.message
        : "Pengeluaran tersimpan lokal, tapi gagal masuk Supabase: " + error.message
    );
  }

  closeCashFlowModal();
}

const cashierOpenTime = cashierSession.openedAt
  ? new Date(cashierSession.openedAt)
  : null;

const cashierSessionTransactions = cashierOpenTime
  ? transactions.filter((transaction) => {
      const transactionDate = new Date(transaction.date);

      return (
        transactionDate >= cashierOpenTime &&
        transaction.status !== "cancelled"
      );
    })
  : [];

const cashierSalesTotal = cashierSessionTransactions.reduce(
  (total, transaction) => total + Number(transaction.total || 0),
  0
);

const cashierProfitTotal = cashierSessionTransactions.reduce(
  (total, transaction) => total + Number(transaction.profit || 0),
  0
);

const cashierDiscountTotal = cashierSessionTransactions.reduce(
  (total, transaction) => total + Number(transaction.discount || 0),
  0
);

const cashierCashInTotal = (cashierSession.cashIn || []).reduce(
  (total, item) => total + Number(item.amount || 0),
  0
);

const cashierCashOutTotal = (cashierSession.cashOut || []).reduce(
  (total, item) => total + Number(item.amount || 0),
  0
);

const estimatedClosingCash =
  Number(cashierSession.openingCash || 0) +
  cashierSalesTotal +
  cashierCashInTotal -
  cashierCashOutTotal;

  const actualClosingCashNumber = Number(actualClosingCash || 0);

const closingCashDifference =
  actualClosingCash === ""
    ? 0
    : actualClosingCashNumber - estimatedClosingCash;

const closingCashStatus =
  actualClosingCash === ""
    ? "Belum dicek"
    : closingCashDifference === 0
      ? "Pas"
      : closingCashDifference > 0
        ? "Lebih"
        : "Kurang";

function closeCashierSession() {
  if (!cashierSession.isOpen) {
    alert("Kasir belum dibuka.");
    return;
  }

  setActualClosingCash("");
  setIsCloseCashierPreviewOpen(true);
}

async function confirmCloseCashierSession() {
  if (actualClosingCash === "") {
    alert("Isi dulu jumlah uang fisik di laci kasir.");
    return;
  }

  const closedAt = new Date().toISOString();

  const closingRecord = {
    id: Date.now(),
    cashierSessionId: cashierSession.id,
    openedAt: cashierSession.openedAt,
    closedAt: closedAt,
    openingCash: Number(cashierSession.openingCash || 0),
    salesTotal: cashierSalesTotal,
    cashInTotal: cashierCashInTotal,
    cashOutTotal: cashierCashOutTotal,
    discountTotal: cashierDiscountTotal,
    profitTotal: cashierProfitTotal,
    transactionCount: cashierSessionTransactions.length,
    estimatedClosingCash: estimatedClosingCash,
    actualClosingCash: actualClosingCashNumber,
    difference: closingCashDifference,
    status: closingCashStatus,
    cashIn: cashierSession.cashIn || [],
    cashOut: cashierSession.cashOut || [],
  };

  const closedSession = {
    ...cashierSession,
    isOpen: false,
    closedAt: closedAt,
    actualClosingCash: actualClosingCashNumber,
    estimatedClosingCash: estimatedClosingCash,
    closingCashDifference: closingCashDifference,
    closingCashStatus: closingCashStatus,
  };

  setCashierClosings((currentClosings) => [
    closingRecord,
    ...currentClosings,
  ]);

  setCashierSession(closedSession);

  try {
    await saveCashierSessionToSupabase(closedSession);
    await createCashierClosingInSupabase(closingRecord);

    alert("Kasir berhasil ditutup dan tersimpan ke Supabase.");
  } catch (error) {
    console.error(error);

    alert(
      "Kasir berhasil ditutup lokal, tapi gagal tersimpan ke Supabase: " +
        error.message
    );
  }

  setIsCloseCashierPreviewOpen(false);
  setActualClosingCash("");
}

function cancelCloseCashierPreview() {
  setIsCloseCashierPreviewOpen(false);
  setActualClosingCash("");
}

if (isUnlocked === false) {
  return (
    <div className="lock-screen">
      <form className="lock-card" onSubmit={submitLogin}>
        <div className="brand-logo">TTM</div>

        <div>
          <h1>{settings.storeName}</h1>
          <p>Pilih user, lalu masukkan PIN.</p>
        </div>

        <div className="pin-role-tabs">
          <button
            type="button"
            className={selectedLoginRole === "admin" ? "pin-role-tab active" : "pin-role-tab"}
            onClick={() => {
              setSelectedLoginRole("admin");
              setLoginPin("");
            }}
          >
            Admin
          </button>

          <button
            type="button"
            className={selectedLoginRole === "cashier" ? "pin-role-tab active" : "pin-role-tab"}
            onClick={() => {
              setSelectedLoginRole("cashier");
              setLoginPin("");
            }}
          >
            Kasir
          </button>
        </div>

        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          value={loginPin}
          onChange={(event) => setLoginPin(event.target.value.replace(/\D/g, ""))}
          placeholder="Masukkan PIN"
          autoFocus
        />

        <button type="submit" className="finish-button" disabled={isAuthLoading}>
          {isAuthLoading ? "Masuk..." : "Masuk"}
        </button>
      </form>
    </div>
  );
}

async function lockPos() {
  await supabase.auth.signOut();
  setIsUnlocked(false);
  setCurrentProfile(null);
  setLoginPin("");
  setSelectedLoginRole("cashier");
}

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">TTM</div>
          <div>
            <h1>{settings.storeName}</h1>
            <p>POS Online</p>
          </div>
        </div>

        <nav className="menu-list">
          {menus.map((menu) => (
            <button
  key={menu.id}
  type="button"
  className={activePage === menu.id ? "menu-item active" : "menu-item"}
  onClick={() => setActivePage(menu.id)}
>
  <span>{menu.label}</span>

  {menu.badge > 0 ? (
    <strong className="nav-badge">{menu.badge}</strong>
  ) : null}
</button>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">POS Toko</p>
            <h2>{pageTitle}</h2>
          </div>

          <div className="topbar-status-group">
            <div className="date-pill">{todayLabel}</div>
            <div className={isOnline ? "connection-pill online" : "connection-pill offline"}>
          {isOnline ? "Online" : "Offline"}
            </div>
            <div className={"supabase-pill " + supabaseStatus}>
           {supabaseStatusLabel}
            </div>

          <div className={
            unsyncedTransactionCount > 0
            ? "auto-sync-pill waiting"
            : "auto-sync-pill active"
          }
        >
          {autoSyncLabel}
          </div>

  <div className="status-pill">POS Online</div>

  <div className="status-pill">
  {currentProfile ? currentProfile.name + " - " + currentProfile.role : "User"}
</div>

  <button type="button" className="lock-button" onClick={lockPos}>
  Lock
</button>
</div>
        </header>

        <section className="page-card">
          {activePage === "dashboard" ? (
            <DashboardPage
  transactions={transactions}
  products={products}
  stockBatches={stockBatches}
  settings={settings}
  cashierSession={cashierSession}
  onOpenCashierSession={openOpenCashierModal}
  onCloseCashierSession={closeCashierSession}
  onOpenCashierPage={() => setActivePage("cashier")}
  onOpenCashInModal={() => openCashFlowModal("in")}
  onOpenCashOutModal={() => openCashFlowModal("out")}
  onOpenSettings={() => setActivePage("settings")}
/>
          ) : null}

          {activePage === "cashier" ? ( 
            <CashierPage 
  products={products}
  productVariants={productVariants}
  stockBatches={stockBatches}
  transactions={transactions}
  settings={settings}
  cashierSession={cashierSession}
  currentProfile={currentProfile}
  onAddTransaction={addTransaction} 
/>
          ) : null}

          {activePage === "products" ? (
            <ProductsPage
              products={products}
              productVariants={productVariants}
              onAddProduct={addProduct}
              onUpdateProduct={updateProduct}
              onDeactivateProduct={deactivateProduct}
              onActivateProduct={activateProduct}
              onAddProductVariant={addProductVariant}
              onUpdateProductVariant={updateProductVariant}
              onDeactivateProductVariant={deactivateProductVariant}
              onActivateProductVariant={activateProductVariant}
            />
          ) : null}

          {activePage === "inventory" ? (
            <InventoryPage
              products={products}
              stockBatches={stockBatches}
              onAddStockBatch={addStockBatch}
            /> 
          ) : null}

          {activePage === "transactions" ? (
  <TransactionsPage
    transactions={transactions}
    settings={settings}
    currentRole={currentRole}
    onClearTransactions={clearTransactions}
    onRetrySingleTransactionSync={retrySingleTransactionSync}
    onCancelTransaction={cancelTransaction}
  />
) : null}

          {activePage === "reports" ? (
  <ReportsPage
    transactions={transactions}
    cashierClosings={cashierClosings}
  />
          ) : null}

          {activePage === "settings" ? (
            <SettingsPage
  settings={settings}
  products={products}
  productVariants={productVariants}
  stockBatches={stockBatches}
  transactions={transactions}
  onUpdateSettings={setSettings}
  onRestoreProducts={setProducts}
  onRestoreProductVariants={setProductVariants}
  onRestoreStockBatches={setStockBatches}
  onRestoreTransactions={setTransactions}
  onTestSupabaseConnection={testSupabaseConnection}
  onRetryFailedTransactionSync={retryFailedTransactionSync}
  onSyncLocalStockBatchesToSupabase={syncLocalStockBatchesToSupabase}
  onRefreshAllDataFromSupabase={refreshAllDataFromSupabase}
/>
          ) : null}

{isOpenCashierModalOpen ? (
  <div className="modal-backdrop">
    <form className="cash-flow-modal open-cashier-modal" onSubmit={submitOpenCashierModal}>
      <div className="modal-header">
        <div>
          <h3>Buka Kasir</h3>
          <p>Masukkan modal awal kasir untuk memulai sesi hari ini.</p>
        </div>

        <button type="button" className="modal-close" onClick={closeOpenCashierModal}>
          ×
        </button>
      </div>

      <div className="cash-flow-form">
        <label>
          Modal Awal
          <input
            type="number"
            min="1"
            value={openingCashInput}
            onChange={(event) => setOpeningCashInput(event.target.value)}
            placeholder="Contoh: 100000"
            autoFocus
          />
        </label>
      </div>

      <div className="payment-actions">
        <button type="button" className="secondary-button" onClick={closeOpenCashierModal}>
          Batal
        </button>

        <button type="submit" className="finish-button">
          Buka Kasir
        </button>
      </div>
    </form>
  </div>
) : null}

          {cashFlowModalType ? (
  <div className="modal-backdrop">
    <form className="cash-flow-modal" onSubmit={submitCashFlow}>
      <div className="modal-header">
        <div>
          <h3>
            {cashFlowModalType === "in" ? "Tambah Pemasukan" : "Tambah Pengeluaran"}
          </h3>
          <p>
            {cashFlowModalType === "in"
              ? "Catat uang masuk di luar transaksi penjualan."
              : "Catat uang keluar dari kasir."}
          </p>
        </div>

        <button type="button" className="modal-close" onClick={closeCashFlowModal}>
          ×
        </button>
      </div>

      <div className="cash-flow-form">
        <label>
          Keterangan
          <input
            type="text"
            value={cashFlowNote}
            onChange={(event) => setCashFlowNote(event.target.value)}
            placeholder={
              cashFlowModalType === "in"
                ? "Contoh: Tambahan modal"
                : "Contoh: Beli plastik"
            }
            autoFocus
          />
        </label>

        <label>
          Nominal
          <input
            type="number"
            min="0"
            value={cashFlowAmount}
            onChange={(event) => setCashFlowAmount(event.target.value)}
            placeholder="0"
          />
        </label>
      </div>

      <div className="payment-actions">
        <button type="button" className="secondary-button" onClick={closeCashFlowModal}>
          Batal
        </button>

        <button type="submit" className="finish-button">
          Simpan
        </button>
      </div>
    </form>
  </div>
) : null}

          {isCloseCashierPreviewOpen ? (
  <div className="modal-backdrop">
    <div className="close-cashier-modal">
      <div className="modal-header">
        <div>
          <h3>Preview Tutup Kasir</h3>
          <p>Periksa rekap kasir sebelum sesi ditutup.</p>
        </div>

        <button
          type="button"
          className="modal-close"
          onClick={cancelCloseCashierPreview}
        >
          ×
        </button>
      </div>

      <div className="close-cashier-summary">
  <div>
    <span>Modal Awal</span>
    <strong>{formatRupiah(cashierSession.openingCash || 0)}</strong>
  </div>

  <div>
    <span>Penjualan Cash</span>
    <strong>{formatRupiah(cashierSalesTotal)}</strong>
  </div>

  <div>
    <span>Pemasukan Lain</span>
    <strong>{formatRupiah(cashierCashInTotal)}</strong>
  </div>

  <div>
    <span>Pengeluaran</span>
    <strong>{formatRupiah(cashierCashOutTotal)}</strong>
  </div>

  <div>
    <span>Diskon</span>
    <strong>{formatRupiah(cashierDiscountTotal)}</strong>
  </div>

  <div>
    <span>Profit FIFO</span>
    <strong>{formatRupiah(cashierProfitTotal)}</strong>
  </div>

  <div>
    <span>Total Transaksi</span>
    <strong>{cashierSessionTransactions.length}</strong>
  </div>
</div>

<div className="closing-cash-total">
  <span>Estimasi Uang Akhir Kasir</span>
  <strong>{formatRupiah(estimatedClosingCash)}</strong>
</div>

<div className="actual-cash-input-box">
  <label>
    Uang Fisik di Laci Kasir
    <input
      type="number"
      min="0"
      value={actualClosingCash}
      onChange={(event) => setActualClosingCash(event.target.value)}
      placeholder="Masukkan jumlah uang di laci"
    />
  </label>
</div>

<div
  className={
    closingCashStatus === "Pas"
      ? "cash-difference-box match"
      : closingCashStatus === "Lebih"
        ? "cash-difference-box over"
        : closingCashStatus === "Kurang"
          ? "cash-difference-box short"
          : "cash-difference-box"
  }
>
  <span>Status Selisih</span>
  <strong>{closingCashStatus}</strong>
  <p>
    {actualClosingCash === ""
      ? "Isi jumlah uang fisik untuk melihat selisih."
      : "Selisih: " + formatRupiah(Math.abs(closingCashDifference))}
  </p>
</div>

<div className="close-cashier-note">
  <strong>Catatan:</strong>
  <p>
    Cocokkan angka estimasi ini dengan uang fisik di laci kasir sebelum
    menutup sesi.
  </p>
</div>

      <div className="payment-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={cancelCloseCashierPreview}
        >
          Batal
        </button>

        <button
          type="button"
          className="danger-button"
          onClick={confirmCloseCashierSession}
        >
          Tutup Kasir
        </button>
      </div>
    </div>
  </div>
) : null}
        </section>
      </main>
    </div>
  );
}

function CashierPage({
  products,
  productVariants,
  stockBatches,
  transactions,
  settings,
  cashierSession,
  currentProfile,
  onAddTransaction,
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [cart, setCart] = useState([]);
  const [returData, setReturData] = useState({ 
  transactionId: null, 
  isOpen: false, 
  reason: '' 
});

const [cancelData, setCancelData] = useState({ 
  transactionId: null, 
  isOpen: false, 
  reason: '' 
});
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
const [cashReceived, setCashReceived] = useState("");
const [discountAmount, setDiscountAmount] = useState("");
const [customerName, setCustomerName] = useState("");
const [customerPhone, setCustomerPhone] = useState("");
const [debtNote, setDebtNote] = useState("");
const [dueDate, setDueDate] = useState("");
const [completedTransaction, setCompletedTransaction] = useState(null);
const [variantPickerProduct, setVariantPickerProduct] = useState(null);

  const activeProducts = useMemo(() => {
  return products
    .filter((product) => product.active)
    .map((product) => ({
      ...product,
      stock: getProductStockFromBatches(product.id, stockBatches),
    }))
    .sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "id-ID", {
        sensitivity: "base",
        numeric: true,
      })
    );
}, [products, stockBatches]);

  const activeVariantsByProductId = useMemo(() => {
  const result = {};

  productVariants
    .filter((variant) => variant.active)
    .forEach((variant) => {
      if (!result[variant.productId]) {
        result[variant.productId] = [];
      }

      result[variant.productId].push(variant);
    });

  Object.keys(result).forEach((productId) => {
    result[productId].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "id-ID", {
        sensitivity: "base",
        numeric: true,
      })
    );
  });

  return result;
}, [productVariants]);

  const categories = useMemo(() => {
  const uniqueCategories = activeProducts
    .map((product) => product.category)
    .filter(Boolean);

  return [
    "Semua",
    ...Array.from(new Set(uniqueCategories)).sort((a, b) =>
      a.localeCompare(b, "id-ID")
    ),
  ];
}, [activeProducts]);

  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return activeProducts.filter((product) => {
      const matchCategory =
        selectedCategory === "Semua" || product.category === selectedCategory;

      const matchSearch =
        product.name.toLowerCase().includes(keyword) ||
        product.category.toLowerCase().includes(keyword);

      return matchCategory && matchSearch;
    });
  }, [activeProducts, search, selectedCategory]);

  const cartSubtotal = useMemo(() => {
    return cart.reduce((total, item) => total + item.price * item.qty, 0);
  }, [cart]);

  const numericDiscountAmount = Number(discountAmount || 0);
  const isDiscountTooLarge = numericDiscountAmount > cartSubtotal;
  const safeDiscountAmount = isDiscountTooLarge ? 0 : numericDiscountAmount;
  const cartTotal = Math.max(cartSubtotal - safeDiscountAmount, 0);

  const numericCashReceived = Number(cashReceived || 0);
const isDebtPayment = paymentMethod === "Hutang";
const debtAmount = isDebtPayment
  ? Math.max(cartTotal - numericCashReceived, 0)
  : 0;
const changeAmount = isDebtPayment ? 0 : numericCashReceived - cartTotal;

const isPaymentValid =
  cart.length > 0 &&
  !isDiscountTooLarge &&
  numericCashReceived >= 0 &&
  (isDebtPayment ? customerName.trim() !== "" : numericCashReceived >= cartTotal);

    const paymentQuickAmounts = useMemo(() => {
  const total = Number(cartTotal || 0);

  if (total <= 0) {
    return [];
  }

  const candidates = [
    total,
    Math.ceil(total / 5000) * 5000,
    Math.ceil(total / 10000) * 10000,
    Math.ceil(total / 50000) * 50000,
    Math.ceil(total / 100000) * 100000,
  ];

  const uniqueAmounts = [];

  candidates.forEach((amount) => {
    if (amount >= total && !uniqueAmounts.includes(amount)) {
      uniqueAmounts.push(amount);
    }
  });

  let nextAmount = uniqueAmounts[uniqueAmounts.length - 1] || total;

  while (uniqueAmounts.length < 4) {
    nextAmount = nextAmount + 5000;

    if (!uniqueAmounts.includes(nextAmount)) {
      uniqueAmounts.push(nextAmount);
    }
  }

  return uniqueAmounts.slice(0, 4);
}, [cartTotal]);

function getCartReservedQty(productId) {
  return cart
    .filter((item) => item.productId === productId || item.id === productId)
    .reduce(
      (total, item) =>
        total + Number(item.qty || 0) * Number(item.qtyMultiplier || 1),
      0
    );
}

function getDisplayStock(productId) {
  const realStock = getProductStockFromBatches(productId, stockBatches);
  const reservedStock = getCartReservedQty(productId);
  return Math.max(0, realStock - reservedStock);
}

function formatProductStockLabel(stock) {
  const numericStock = Number(stock || 0);
  return numericStock <= 0 ? "0" : String(numericStock);
}

function formatVariantShortLabel(variant) {
  const multiplier = Number(variant.qtyMultiplier || 1);

  if (multiplier > 1) {
    return multiplier + " PCS";
  }

  const rawName = String(variant.name || "").trim();

  if (!rawName) {
    return "1 PCS";
  }

  return rawName
    .replace(/(\d+)\s*pcs/gi, "$1 pc")
    .replace(/(\d+)\s*pc/gi, "$1 PCS")
    .toUpperCase();
}

function handleProductClick(product) {
  const productVariantsForCashier = activeVariantsByProductId[product.id] || [];

  if (productVariantsForCashier.length > 0) {
    setVariantPickerProduct(product);
    return;
  }

  addToCart(product, null);
}

function handleVariantClick(product, variant) {
  addToCart(product, variant);
  setVariantPickerProduct(null);
}

function addToCart(product, variant) {
  const selectedVariant = variant || null;
  const qtyMultiplier = selectedVariant ? Number(selectedVariant.qtyMultiplier || 1) : 1;

  if (Number(product.stock || 0) < qtyMultiplier) {
    alert("Stok tidak cukup untuk pilihan ini.");
    return;
  }

  const cartItemId = selectedVariant
    ? String(product.id) + "-variant-" + String(selectedVariant.id)
    : String(product.id) + "-default";

  const displayName = selectedVariant
    ? product.name + " - " + selectedVariant.name
    : product.name;

  const salePrice = selectedVariant ? selectedVariant.price : product.price;

  setCart((currentCart) => {
    const existingItem = currentCart.find((item) => item.cartItemId === cartItemId);
    const currentFifoQty = currentCart
  .filter((item) => item.productId === product.id)
  .reduce(
    (total, item) =>
      total + Number(item.qty || 0) * Number(item.qtyMultiplier || 1),
    0
  );

const nextFifoQty = currentFifoQty + qtyMultiplier;
const displayStock = getDisplayStock(product.id, product.stock);

if (nextFifoQty > Number(product.stock || 0)) {
  alert("Stok tidak cukup untuk pilihan ini.");
  return currentCart;
}

if (existingItem) {
      return currentCart.map((item) =>
        item.cartItemId === cartItemId
          ? {
              ...item,
              qty: item.qty + 1,
            }
          : item
      );
}

    return [
      ...currentCart,
      {
        cartItemId: cartItemId,
        id: product.id,
        productId: product.id,
        variantId: selectedVariant ? selectedVariant.id : null,
        name: displayName,
        productName: product.name,
        variantName: selectedVariant ? selectedVariant.name : null,
        category: product.category,
        price: salePrice,
        cost: product.cost,
        unit: product.unit,
        qty: 1,
        qtyMultiplier: qtyMultiplier,
      },
    ];
  });
}

function increaseQty(cartItemId) {
  setCart((currentCart) => {
    const selectedItem = currentCart.find(
      (item) => item.cartItemId === cartItemId
    );

    if (!selectedItem) {
      return currentCart;
    }

    const product = activeProducts.find(
      (item) => item.id === selectedItem.productId
    );

    const availableStock = product ? Number(product.stock || 0) : 0;
    const currentFifoQty = currentCart
      .filter((item) => item.productId === selectedItem.productId)
      .reduce(
        (total, item) =>
          total + Number(item.qty || 0) * Number(item.qtyMultiplier || 1),
        0
      );

    const nextFifoQty =
      currentFifoQty + Number(selectedItem.qtyMultiplier || 1);

    if (nextFifoQty > availableStock) {
      alert("Stok tidak cukup untuk menambah qty.");
      return currentCart;
    }

    return currentCart.map((item) =>
      item.cartItemId === cartItemId
        ? {
            ...item,
            qty: item.qty + 1,
          }
        : item
    );
  });
}

function decreaseQty(cartItemId) {
  setCart((currentCart) =>
    currentCart
      .map((item) =>
        item.cartItemId === cartItemId
          ? {
              ...item,
              qty: item.qty - 1,
            }
          : item
      )
      .filter((item) => item.qty > 0)
  );
}

function clearCart() {
  setCart([]);
  setDiscountAmount("");
  setPaymentMethod("Cash");
  setCashReceived("");
  setCustomerName("");
  setCustomerPhone("");
  setDebtNote("");
  setDueDate("");
}

function openPaymentModal() {
   if (!cashierSession.isOpen) {
    alert("Kasir belum dibuka. Buka kasir dari Dashboard terlebih dahulu.");
    return;
  }

  if (cart.length === 0) return;
  if (isDiscountTooLarge) return;

  setPaymentMethod("Cash");
setCashReceived(String(cartTotal));
setCustomerName("");
setCustomerPhone("");
setDebtNote("");
setDueDate("");
setIsPaymentOpen(true);
}

function closePaymentModal() {
  setIsPaymentOpen(false);
  setPaymentMethod("Cash");
  setCashReceived("");
  setCustomerName("");
  setCustomerPhone("");
  setDebtNote("");
  setDueDate("");
}

function finishTransaction() {
  if (!isPaymentValid) {
    alert("Pembayaran belum valid. Cek uang diterima atau diskon.");
    return;
  }

  const fifoResult = processFifoSale(cart, stockBatches);

  if (!fifoResult.success) {
    alert(fifoResult.message);
    return;
  }

  const now = new Date();
  const transactionId = "TRX-" + now.getTime();
  const transactionCode = createTransactionCode();

  const totalProfitBeforeDiscount = fifoResult.items.reduce(
    (total, item) => total + item.profit,
    0
  );

  const paidAmount = isDebtPayment
  ? Math.min(numericCashReceived, cartTotal)
  : cartTotal;

const finalDebtAmount = isDebtPayment
  ? Math.max(cartTotal - paidAmount, 0)
  : 0;

const paymentStatus = finalDebtAmount > 0
  ? paidAmount > 0
    ? "partial"
    : "unpaid"
  : "paid";

const transaction = {
  id: transactionId,
  code: transactionCode,
  date: now.toISOString(),
  items: fifoResult.items,
  subtotal: cartSubtotal,
  discount: safeDiscountAmount,
  total: cartTotal,
  cashReceived: paidAmount,
  change: changeAmount,
  paymentMethod: paymentMethod,
  profit: totalProfitBeforeDiscount - safeDiscountAmount,
  cashierName: currentProfile ? currentProfile.name : "",
  cashierRole: currentProfile ? currentProfile.role : "",
  paymentStatus: paymentStatus,
  paidAmount: paidAmount,
  debtAmount: finalDebtAmount,
  customerName: customerName.trim(),
  customerPhone: customerPhone.trim(),
  debtNote: debtNote.trim(),
  dueDate: dueDate || "",
};

  onAddTransaction(transaction, fifoResult.updatedBatches);

  setCompletedTransaction(transaction);

  setCart([]);
setPaymentMethod("Cash");
setCashReceived("");
setDiscountAmount("");
setCustomerName("");
setCustomerPhone("");
setDebtNote("");
setDueDate("");
setIsPaymentOpen(false);
}

  return (
    <div>
      {!cashierSession.isOpen ? (
  <div className="cashier-closed-warning">
    <strong>Kasir belum dibuka</strong>
    <p>Buka kasir dari Dashboard sebelum melakukan transaksi.</p>
  </div>
) : null}
      <div className="cashier-header">
        <div>
          <h3>Kasir</h3>
          <p className="muted">
            Pilih produk, masukkan ke keranjang, lalu cek total belanja.
          </p>
        </div>

        <div className="cashier-total-box">
          <span>Total Setelah Diskon</span>
          <strong>{formatRupiah(cartTotal)}</strong>
        </div>
      </div>

      <div className="cashier-layout">
        <div className="product-area">
          <div className="product-toolbar">
            <input
              type="search"
              placeholder="Cari produk..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="category-tabs">
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={
                  selectedCategory === category
                    ? "category-tab active"
                    : "category-tab"
                }
                onClick={() => setSelectedCategory(category)}
              >
                {String(category || "").toUpperCase()}
              </button>
            ))}
          </div>

          <div className="product-grid">
            {filteredProducts.map((product) => {
  const productVariantsForCashier = activeVariantsByProductId[product.id] || [];
  const reservedQty = cart
  .filter((item) => item.productId === product.id)
  .reduce(
    (total, item) =>
      total + Number(item.qty || 0) * Number(item.qtyMultiplier || 1),
    0
  );

const displayStock = Math.max(0, Number(product.stock || 0) - reservedQty);

  return (
    <div
  key={product.id}
  className={
    productVariantsForCashier.length > 0
      ? "product-card has-variants"
      : "product-card no-variants"
  }
>
      <button
  type="button"
  className="product-main-button"
  disabled={displayStock <= 0}
  onClick={() => handleProductClick(product)}
>
        <h4>{String(product.name || "").toUpperCase()}</h4>

<p>{String(product.category || "").toUpperCase()}</p>

<div className="product-card-footer">
  <strong>
    {productVariantsForCashier.length > 0
      ? productVariantsForCashier.length + " VARIAN"
      : formatRupiah(product.price)}
  </strong>

  <span
    className={
      Number(displayStock || 0) <= 0
        ? "product-stock-badge stock-empty"
        : "product-stock-badge"
    }
    title={"Stok tersedia: " + displayStock}
  >
    {formatProductStockLabel(displayStock)}
  </span>
</div>
</button>
    </div>
  );
})}

            {filteredProducts.length === 0 ? (
              <div className="empty-state">
                Produk tidak ditemukan.
              </div>
            ) : null}
          </div>
        </div>

<div className="cart-panel">
  <div className="cart-header">
    <div>
      <h3>Keranjang</h3>
      <p>{cart.length} jenis produk</p>
    </div>

    {cart.length > 0 && (
      <button className="secondary-button" onClick={clearCart}>
        Kosongkan
      </button>
    )}
  </div>

  <div className="cart-scroll-area">
    {cart.length === 0 ? (
      <div className="empty-state">Keranjang masih kosong</div>
    ) : (
      cart.map((item) => (
        <div className="cart-line" key={item.cartItemId}>
          <div className="cart-line-top">
            <div className="cart-line-info">
              <h5>{String(item.name || "").toUpperCase()}</h5>
              <p>
                {formatRupiah(item.price)} /{" "}
                {String(item.unit || "PCS").toUpperCase()}
                {Number(item.qtyMultiplier || 1) > 1
                  ? " • FIFO " +
                    item.qtyMultiplier +
                    " " +
                    String(item.unit || "PCS").toUpperCase()
                  : ""}
              </p>
            </div>

            <div className="cart-line-price">
              {formatRupiah(item.price * item.qty)}
            </div>
          </div>

          <div className="cart-line-bottom">
            <div className="qty-control">
              <button type="button" onClick={() => decreaseQty(item.cartItemId)}>
                -
              </button>

              <span>{item.qty}</span>

              <button type="button" onClick={() => increaseQty(item.cartItemId)}>
                +
              </button>
            </div>
          </div>
        </div>
      ))
    )}
  </div>


          <div className="cart-summary">
            <label className="discount-field">
              Diskon Rupiah
              <input
                type="number"
                min="0"
                value={discountAmount}
                onChange={(event) => setDiscountAmount(event.target.value)}
                placeholder="0"
                disabled={cart.length === 0}
              />
            </label>

            <div>
              <span>Subtotal</span>
              <strong>{formatRupiah(cartSubtotal)}</strong>
            </div>

            <div>
              <span>Diskon</span>
              <strong>{formatRupiah(safeDiscountAmount)}</strong>
            </div>

            <div className="cart-total-plain">
              <span>Total Belanja</span>
              <strong>{formatRupiah(cartTotal)}</strong>
            </div>

            {isDiscountTooLarge ? (
              <p className="discount-warning">
                Diskon tidak boleh lebih besar dari subtotal. Silakan periksa kembali.
              </p>
            ) : null}

            <button
              type="button"
              className="pay-button"
              disabled={!cashierSession.isOpen || cart.length === 0 || isDiscountTooLarge}
              onClick={openPaymentModal}
            >
              Bayar
            </button>
          </div>
        </div>
      </div>

      {variantPickerProduct ? (() => {
  const variantOptions = activeVariantsByProductId[variantPickerProduct.id] || [];
  const displayStock = getDisplayStock(variantPickerProduct.id);

  return (
    <div
      className="variant-picker-backdrop"
      onClick={() => setVariantPickerProduct(null)}
    >
      <div
        className="variant-picker-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="variant-picker-header">
          <div>
            <p>Pilih Varian</p>
            <h3>{String(variantPickerProduct.name || "").toUpperCase()}</h3>
            <span>
              {String(variantPickerProduct.category || "").toUpperCase()} • Stok tersedia {displayStock}
            </span>
          </div>

          <button
            type="button"
            className="modal-close"
            onClick={() => setVariantPickerProduct(null)}
          >
            ×
          </button>
        </div>

        <div className="variant-picker-grid">
          {variantOptions.map((variant) => {
            const variantStockNeeded = Number(variant.qtyMultiplier || 1);
            const isVariantOutOfStock = Number(displayStock || 0) < variantStockNeeded;

            return (
              <button
                type="button"
                key={variant.id}
                className={
                  isVariantOutOfStock
                    ? "variant-picker-option disabled"
                    : "variant-picker-option"
                }
                disabled={isVariantOutOfStock}
                onClick={() => handleVariantClick(variantPickerProduct, variant)}
              >
                <strong>{String(variant.name || "").toUpperCase()}</strong>
                <span>
                  Ambil stok {variant.qtyMultiplier}{" "}
                  {String(variantPickerProduct.unit || "PCS").toUpperCase()}
                </span>
                <em>{formatRupiah(variant.price)}</em>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
})() : null}

      {isPaymentOpen ? (
        <div className="modal-backdrop">
          <div className="payment-modal">
            <div className="modal-header">
              <div>
                <h3>Pembayaran</h3>
                <p>Masukkan uang yang diterima dari pembeli.</p>
              </div>

              <button type="button" className="modal-close" onClick={closePaymentModal}>
                ×
              </button>
            </div>

            <div className="payment-summary">
  <div>
    <span>Subtotal</span>
    <strong>{formatRupiah(cartSubtotal)}</strong>
  </div>

  <div>
    <span>Diskon</span>
    <strong>{formatRupiah(safeDiscountAmount)}</strong>
  </div>

  <div>
    <span>Total Belanja</span>
    <strong>{formatRupiah(cartTotal)}</strong>
  </div>

  <div className="payment-method-tabs">
  <button
    type="button"
    className={paymentMethod === "Cash" ? "payment-method-tab active" : "payment-method-tab"}
    onClick={() => {
      setPaymentMethod("Cash");
      setCashReceived(String(cartTotal));
      setCustomerName("");
      setCustomerPhone("");
      setDebtNote("");
      setDueDate("");
    }}
  >
    Cash
  </button>

  <button
    type="button"
    className={paymentMethod === "Hutang" ? "payment-method-tab active" : "payment-method-tab"}
    onClick={() => {
      setPaymentMethod("Hutang");
      setCashReceived("0");
    }}
  >
    Hutang
  </button>
</div>

  <label>
  {paymentMethod === "Hutang" ? "Dibayar Sekarang" : "Uang Diterima"}
    <input
      type="number"
      min="0"
      value={cashReceived}
      onChange={(event) => setCashReceived(event.target.value)}
      autoFocus
    />
  </label>

  {paymentMethod === "Hutang" ? (
  <div className="debt-fields">
  
  <div className="debt-row">
  <label>
    Nama Pelanggan
    <input
      type="text"
      value={customerName}
      onChange={(event) => setCustomerName(event.target.value)}
      placeholder="Contoh: Bu Siti"
    />
  </label>

  <label>
    No WA Pelanggan
    <input
      type="text"
      value={customerPhone}
      onChange={(event) => setCustomerPhone(event.target.value)}
      placeholder="Opsional"
    />
  </label>
  </div>

<div className="debt-row">
  <label>
    Jatuh Tempo
    <input
      type="date"
      value={dueDate}
      onChange={(event) => setDueDate(event.target.value)}
    />
  </label>

  <div className="debt-summary">
    <span>Sisa Hutang</span>
    <strong className={debtAmount > 0 ? "danger-text" : ""}>
      {formatRupiah(debtAmount)}
    </strong>
  </div>
  </div>

  <label className="full-width">
    Catatan
    <input
      type="text"
      value={debtNote}
      onChange={(event) => setDebtNote(event.target.value)}
      placeholder="Opsional"
    />
  </label>
</div>
  ) : null}

  {paymentMethod === "Cash" ? (
  <div className="quick-cash-buttons">
    {paymentQuickAmounts.map((amount) => (
      <button
        key={amount}
        type="button"
        className={
          Number(cashReceived || 0) === amount
            ? "quick-cash-button active"
            : "quick-cash-button"
        }
        onClick={() => setCashReceived(String(amount))}
      >
        {formatRupiah(amount)}
      </button>
    ))}
  </div>
) : null}

  {paymentMethod === "Cash" ? (
  <div>
    <span>Kembalian</span>
    <strong className={changeAmount < 0 ? "danger-text" : ""}>
      {formatRupiah(changeAmount)}
    </strong>
  </div>
) : null}

  {paymentMethod === "Cash" && changeAmount < 0 ? (
    <p className="payment-warning">
      Uang diterima masih kurang {formatRupiah(Math.abs(changeAmount))}.
    </p>
  ) : null}
</div>

            <div className="payment-actions">
              <button type="button" className="secondary-button" onClick={closePaymentModal}>
                Batal
              </button>

              <button
                type="button"
                className="finish-button"
                disabled={!isPaymentValid}
                onClick={finishTransaction}
              >
                Selesaikan Transaksi
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {completedTransaction ? (
  <ReceiptModal
    transaction={completedTransaction}
    settings={settings}
    onClose={() => setCompletedTransaction(null)}
  />
) : null}
    </div>
  );
}

function DashboardPage({
  transactions,
  products,
  stockBatches,
  settings,
  cashierSession,
  onOpenCashierSession,
  onCloseCashierSession,
  onOpenCashierPage,
  onOpenCashInModal,
  onOpenCashOutModal,
  onOpenSettings,
}) {
  const today = new Date();

  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const todayTransactions = transactions.filter((transaction) => {
    const transactionDate = new Date(transaction.date);
    return transactionDate >= startOfToday && transactionDate < startOfTomorrow;
  });

  const todayRevenue = todayTransactions.reduce(
    (total, transaction) => total + Number(transaction.total || 0),
    0
  );

  const todayProfit = todayTransactions.reduce(
    (total, transaction) => total + Number(transaction.profit || 0),
    0
  );

  const todayDiscount = todayTransactions.reduce(
    (total, transaction) => total + Number(transaction.discount || 0),
    0
  );

  const todayFifoQty = todayTransactions.reduce((total, transaction) => {
    const transactionFifoQty = transaction.items.reduce(
      (itemTotal, item) =>
        itemTotal + Number(item.fifoQty || item.qty || 0),
      0
    );

    return total + transactionFifoQty;
  }, 0);

  const productSalesMap = {};

  todayTransactions.forEach((transaction) => {
    transaction.items.forEach((item) => {
      const key = item.name;

      if (!productSalesMap[key]) {
        productSalesMap[key] = {
          name: item.name,
          qty: 0,
          fifoQty: 0,
          revenue: 0,
        };
      }

      productSalesMap[key].qty =
        productSalesMap[key].qty + Number(item.qty || 0);

      productSalesMap[key].fifoQty =
        productSalesMap[key].fifoQty + Number(item.fifoQty || item.qty || 0);

      productSalesMap[key].revenue =
        productSalesMap[key].revenue + Number(item.subtotal || 0);
    });
  });

  const topProductsToday = Object.values(productSalesMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  const lowStockProducts = products
    .filter((product) => product.active)
    .map((product) => {
      const totalStock = getProductStockFromBatches(product.id, stockBatches);

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        stock: totalStock,
        unit: product.unit,
      };
    })
    .filter((product) => product.stock <=
    Number(settings.lowStockThreshold || 10))
    .sort((a, b) => a.stock - b.stock)
    .slice(0, 8);

const unsyncedTransactions = transactions.filter(
  (transaction) =>
    transaction.syncStatus === "failed" || transaction.syncStatus === "pending"
);

const failedTransactions = transactions.filter(
  (transaction) => transaction.syncStatus === "failed"
);

const pendingTransactions = transactions.filter(
  (transaction) => transaction.syncStatus === "pending"
);

const dashboardCashierOpenTime = cashierSession.openedAt
  ? new Date(cashierSession.openedAt)
  : null;

const dashboardCashierTransactions = dashboardCashierOpenTime
  ? transactions.filter((transaction) => {
      const transactionDate = new Date(transaction.date);
      return transactionDate >= dashboardCashierOpenTime;
    })
  : [];

const dashboardCashierSalesTotal = dashboardCashierTransactions.reduce(
  (total, transaction) => total + Number(transaction.cashReceived || 0),
  0
);

const dashboardCashierProfitTotal = dashboardCashierTransactions.reduce(
  (total, transaction) => total + Number(transaction.profit || 0),
  0
);

const dashboardCashInTotal = (cashierSession.cashIn || []).reduce(
  (total, item) => total + Number(item.amount || 0),
  0
);

const dashboardCashOutTotal = (cashierSession.cashOut || []).reduce(
  (total, item) => total + Number(item.amount || 0),
  0
);

const dashboardEstimatedCash =
  Number(cashierSession.openingCash || 0) +
  dashboardCashierSalesTotal +
  dashboardCashInTotal -
  dashboardCashOutTotal;

  return (
    <div>
      <div className="dashboard-header">
  <div className="dashboard-hero-grid">
    <div className="cashier-command-panel">
      <div>
        <span>Status Kasir</span>
        <strong>{cashierSession.isOpen ? "Kasir Dibuka" : "Kasir Ditutup"}</strong>
        <p>
          {cashierSession.isOpen && cashierSession.openedAt
            ? "Dibuka " +
              new Date(cashierSession.openedAt).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              })
            : "Buka kasir sebelum mulai transaksi."}
        </p>
      </div>

      <div className="cashier-command-actions">
        <button
          type="button"
          className="primary-action-button"
          onClick={onOpenCashierSession}
          disabled={cashierSession.isOpen}
        >
          Buka Kasir
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={onOpenCashierPage}
          disabled={!cashierSession.isOpen}
        >
          Ke Kasir
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={onOpenCashInModal}
          disabled={!cashierSession.isOpen}
        >
          Pemasukan
        </button>

        <button
          type="button"
          className="secondary-button"
          onClick={onOpenCashOutModal}
          disabled={!cashierSession.isOpen}
        >
          Pengeluaran
        </button>

        <button
          type="button"
          className="danger-button"
          onClick={onCloseCashierSession}
          disabled={!cashierSession.isOpen}
        >
          Tutup Kasir
        </button>
      </div>
    </div>

    <div className="cashier-today-panel">
      <div className="cashier-today-panel-header">
        <div>
          <span>Ringkasan Kasir Hari Ini</span>
          <strong>{formatRupiah(dashboardEstimatedCash)}</strong>
          <p>Estimasi uang akhir kasir saat ini.</p>
        </div>

        <div className={cashierSession.isOpen ? "cashier-today-status open" : "cashier-today-status closed"}>
          {cashierSession.isOpen ? "Aktif" : "Tutup"}
        </div>
      </div>

      <div className="cashier-today-metrics">
        <div>
          <span>Modal Awal</span>
          <strong>{formatRupiah(cashierSession.openingCash || 0)}</strong>
        </div>

        <div>
          <span>Kas Diterima</span>
          <strong>{formatRupiah(dashboardCashierSalesTotal)}</strong>
        </div>

        <div>
          <span>Pemasukan</span>
          <strong>{formatRupiah(dashboardCashInTotal)}</strong>
        </div>

        <div>
          <span>Pengeluaran</span>
          <strong>{formatRupiah(dashboardCashOutTotal)}</strong>
        </div>

        <div>
          <span>Transaksi Sesi</span>
          <strong>{dashboardCashierTransactions.length}</strong>
        </div>

        <div>
          <span>Profit Sesi</span>
          <strong>{formatRupiah(dashboardCashierProfitTotal)}</strong>
        </div>
      </div>
    </div>
  </div>

  <div className="dashboard-title-row">
    <h3>Dashboard</h3>
    <p className="muted">
      Ringkasan performa toko hari ini berdasarkan transaksi dan stok FIFO.
    </p>
  </div>
</div>

      <div className="dashboard-summary">
        <div>
          <span>Omzet Hari Ini</span>
          <strong>{formatRupiah(todayRevenue)}</strong>
        </div>

        <div>
          <span>Profit FIFO Hari Ini</span>
          <strong>{formatRupiah(todayProfit)}</strong>
        </div>

        <div>
          <span>Transaksi Hari Ini</span>
          <strong>{todayTransactions.length}</strong>
        </div>

        <div>
          <span>Qty FIFO Keluar</span>
          <strong>{todayFifoQty}</strong>
        </div>

        <div>
          <span>Diskon Hari Ini</span>
          <strong>{formatRupiah(todayDiscount)}</strong>
        </div>

        <div>
          <span>Total Riwayat Transaksi</span>
          <strong>{transactions.length}</strong>
        </div>

        <div>
  <span>Status Supabase</span>
  <strong>{settings.autoLoadSupabase ? "Auto Load ON" : "Auto Load OFF"}</strong>
  <small>
    {unsyncedTransactions.length > 0
      ? failedTransactions.length +
        " gagal, " +
        pendingTransactions.length +
        " pending"
      : "Semua transaksi lokal aman"}
  </small>
</div>

<div>
  <span>Produk Stok Rendah</span>
  <strong>{lowStockProducts.length}</strong>
  <small>
    Batas stok {settings.lowStockThreshold} atau kurang
  </small>
</div>
      </div>

      {unsyncedTransactions.length > 0 ? (
  <div className="sync-warning-box">
    <div>
      <strong>Ada transaksi belum tersinkron</strong>
      <p>
        Klik tombol di bawah untuk masuk ke Pengaturan lalu jalankan Sinkron
        Ulang Gagal.
      </p>
    </div>

    <button
      type="button"
      className="secondary-button"
      onClick={onOpenSettings}
    >
      Buka Pengaturan
    </button>
  </div>
) : null}

      <div className="dashboard-grid">
        <div className="dashboard-section">
          <div className="section-title">
            <h4>Produk / Varian Terlaris Hari Ini</h4>
            <p>Berdasarkan qty jual hari ini.</p>
          </div>

          <div className="dashboard-list">
            {topProductsToday.map((product, index) => (
              <div key={product.name} className="dashboard-list-item">
                <div>
                  <strong>
                    {index + 1}. {product.name}
                  </strong>
                  <p>
                    Qty jual {product.qty} • FIFO keluar {product.fifoQty}
                  </p>
                </div>

                <span>{formatRupiah(product.revenue)}</span>
              </div>
            ))}

            {topProductsToday.length === 0 ? (
              <div className="empty-state">
                Belum ada penjualan hari ini.
              </div>
            ) : null}
          </div>
        </div>

        <div className="dashboard-section">
          <div className="section-title">
            <h4>Stok Rendah</h4>
            <p>Produk aktif dengan stok FIFO {settings.lowStockThreshold} atau kurang.</p>
          </div>

          <div className="dashboard-list">
            {lowStockProducts.map((product) => (
              <div key={product.id} className="dashboard-list-item">
                <div>
                  <strong>{product.name}</strong>
                  <p>{product.category}</p>
                </div>

                <span>
                  {product.stock} {product.unit}
                </span>
              </div>
            ))}

            {lowStockProducts.length === 0 ? (
              <div className="empty-state">
                Tidak ada stok rendah.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="section-title">
          <h4>Transaksi Terbaru Hari Ini</h4>
          <p>5 transaksi terakhir dari hari ini.</p>
        </div>

        <div className="dashboard-table-wrap">
          <table className="dashboard-table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Waktu</th>
                <th>Item</th>
                <th>Total</th>
                <th>Profit</th>
              </tr>
            </thead>

            <tbody>
              {todayTransactions.slice(0, 5).map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <strong>{transaction.code}</strong>
                  </td>
                  <td>
                    {new Date(transaction.date).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    })}
                  </td>
                  <td>{transaction.items.length}</td>
                  <td>{formatRupiah(transaction.total || 0)}</td>
                  <td>{formatRupiah(transaction.profit || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {todayTransactions.length === 0 ? (
            <div className="empty-state">
              Belum ada transaksi hari ini.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProductsPage({
  products,
  productVariants,
  onAddProduct,
  onUpdateProduct,
  onDeactivateProduct,
  onActivateProduct,
  onAddProductVariant,
  onUpdateProductVariant,
  onDeactivateProductVariant,
  onActivateProductVariant,
}) {
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productUnit, setProductUnit] = useState("pcs");
  const [selectedVariantProduct, setSelectedVariantProduct] = useState(null);
  const [editingVariant, setEditingVariant] = useState(null);
  const [variantName, setVariantName] = useState("");
  const [variantQtyMultiplier, setVariantQtyMultiplier] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
const [productSearch, setProductSearch] = useState("");

const sortedProducts = [...products].sort((a, b) =>
  String(a.name || "").localeCompare(String(b.name || ""), "id-ID", {
    sensitivity: "base",
    numeric: true,
  })
);

const filteredProducts = sortedProducts.filter((product) => {
  const keyword = productSearch.trim().toLowerCase();

  if (!keyword) {
    return true;
  }

  return (
    product.name.toLowerCase().includes(keyword) ||
    product.category.toLowerCase().includes(keyword) ||
    product.unit.toLowerCase().includes(keyword)
  );
});

  const activeProductCount = products.filter((product) => product.active).length;
  const inactiveProductCount = products.length - activeProductCount;

  function resetProductForm() {
    setEditingProduct(null);
    setProductName("");
    setProductCategory("");
    setProductPrice("");
    setProductUnit("pcs");
  }

  function openAddProductForm() {
    resetProductForm();
    setIsProductFormOpen(true);
  }

  function openEditProductForm(product) {
    setEditingProduct(product);
    setProductName(product.name);
    setProductCategory(product.category);
    setProductPrice(String(product.price));
    setProductUnit(product.unit);
    setIsProductFormOpen(true);
  }

  function closeProductForm() {
    setIsProductFormOpen(false);
    resetProductForm();
  }

  function submitProductForm(event) {
    event.preventDefault();

    const name = productName.trim();
    const category = productCategory.trim();
    const price = Number(productPrice || 0);
    const unit = productUnit.trim();

    if (!name) {
      alert("Nama produk wajib diisi.");
      return;
    }

    if (!category) {
      alert("Kategori produk wajib diisi.");
      return;
    }

    if (price <= 0) {
      alert("Harga jual harus lebih dari 0.");
      return;
    }

    if (!unit) {
      alert("Satuan wajib diisi.");
      return;
    }

    if (editingProduct) {
      const updatedProduct = {
        ...editingProduct,
        name: name,
        category: category,
        price: price,
        unit: unit,
      };

      onUpdateProduct(updatedProduct);
      alert("Produk berhasil diperbarui.");
      closeProductForm();
      return;
    }

    const newProduct = {
      id: Date.now(),
      name: name,
      category: category,
      price: price,
      cost: 0,
      stock: 0,
      unit: unit,
      active: true,
    };

    onAddProduct(newProduct);
    alert("Produk berhasil ditambahkan.");
    closeProductForm();
  }

  function resetVariantForm() {
  setEditingVariant(null);
  setVariantName("");
  setVariantQtyMultiplier("");
  setVariantPrice("");
}

function openVariantModal(product) {
  setSelectedVariantProduct(product);
  resetVariantForm();
}

function closeVariantModal() {
  setSelectedVariantProduct(null);
  resetVariantForm();
}

function openEditVariantForm(variant) {
  setEditingVariant(variant);
  setVariantName(variant.name);
  setVariantQtyMultiplier(String(variant.qtyMultiplier));
  setVariantPrice(String(variant.price));
}

function submitVariantForm(event) {
  event.preventDefault();

  if (!selectedVariantProduct) {
    alert("Produk belum dipilih.");
    return;
  }

  const name = variantName.trim();
  const qtyMultiplier = Number(variantQtyMultiplier || 0);
  const price = Number(variantPrice || 0);

  if (!name) {
    alert("Nama varian wajib diisi.");
    return;
  }

  if (qtyMultiplier <= 0) {
    alert("Qty multiplier harus lebih dari 0.");
    return;
  }

  if (price <= 0) {
    alert("Harga varian harus lebih dari 0.");
    return;
  }

  if (editingVariant) {
    const updatedVariant = {
      ...editingVariant,
      name: name,
      qtyMultiplier: qtyMultiplier,
      price: price,
    };

    onUpdateProductVariant(updatedVariant);
    alert("Varian berhasil diperbarui.");
    resetVariantForm();
    return;
  }

  const newVariant = {
    id: Date.now(),
    productId: selectedVariantProduct.id,
    name: name,
    qtyMultiplier: qtyMultiplier,
    price: price,
    active: true,
  };

  onAddProductVariant(newVariant);
  alert("Varian berhasil ditambahkan.");
  resetVariantForm();
}

  return (
    <div>
      <div className="products-header">
  <div>
    <h3>Produk</h3>
    <p className="muted">
      Kelola data produk. Stok tetap dikelola dari batch FIFO di menu Stok.
    </p>
  </div>
</div>

      <div className="products-summary">
  <div>
    <span>Total Produk</span>
    <strong>{products.length}</strong>
  </div>

  <div>
    <span>Produk Aktif</span>
    <strong>{activeProductCount}</strong>
  </div>

  <div>
    <span>Produk Nonaktif</span>
    <strong>{inactiveProductCount}</strong>
  </div>
</div>

<div className="products-sticky-tools">
  <div className="products-search-box">
    <span>🔎</span>
    <input
      type="text"
      value={productSearch}
      onChange={(event) => setProductSearch(event.target.value)}
      placeholder="Cari nama produk, kategori, atau satuan..."
    />
  </div>

  <div className="products-tool-actions">
    <span className="products-result-count">
      {filteredProducts.length} dari {products.length} produk
    </span>

    <button
      type="button"
      className="primary-action-button"
      onClick={openAddProductForm}
    >
      Tambah Produk
    </button>
  </div>
</div>

<div className="products-table-wrap">
        <table className="products-table">
          <thead>
            <tr>
              <th>Produk</th>
              <th>Kategori</th>
              <th>Harga Jual</th>
              <th>Satuan</th>
              <th>Varian</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>

          <tbody>
            {filteredProducts.map((product) => {
  const activeVariantCount = productVariants.filter(
    (variant) => variant.productId === product.id && variant.active
  ).length;

  return (
    <tr key={product.id} className={product.active ? "" : "inactive-product-row"}>
                <td>
                  <strong>{product.name}</strong>
                </td>
                <td>{product.category}</td>
                <td>{formatRupiah(product.price)}</td>
                <td>{product.unit}</td>
                <td>
                  <span className="variant-count-pill">
                    {activeVariantCount} varian
                  </span>
                </td>
                <td>
                  <span className={product.active ? "product-status active" : "product-status inactive"}>
                    {product.active ? "Aktif" : "Nonaktif"}
                  </span>
                </td>
                <td>
  <div className="table-actions">
    <button
      type="button"
      className="small-edit-button"
      onClick={() => openEditProductForm(product)}
    >
      Edit
    </button>

    <button
      type="button"
      className="small-variant-button"
      onClick={() => openVariantModal(product)}
    >
      Varian
    </button>

    {product.active ? (
      <button
        type="button"
        className="small-danger-button"
        onClick={() => onDeactivateProduct(product.id)}
      >
        Nonaktifkan
      </button>
    ) : (
      <button
        type="button"
        className="small-activate-button"
        onClick={() => onActivateProduct(product.id)}
      >
        Aktifkan
      </button>
    )}
  </div>
</td>
              </tr>
              );
            })}
          </tbody>
        </table>

        {products.length === 0 ? (
  <div className="empty-state">
    Belum ada produk.
  </div>
) : null}

{products.length > 0 && filteredProducts.length === 0 ? (
  <div className="empty-state">
    Tidak ada produk yang cocok dengan pencarian.
  </div>
) : null}
      </div>

      {isProductFormOpen ? (
        <div className="modal-backdrop">
          <div className="product-modal">
            <div className="modal-header">
              <div>
                <h3>{editingProduct ? "Edit Produk" : "Tambah Produk"}</h3>
                <p>Isi data produk. Batch stok ditambahkan dari menu Stok.</p>
              </div>

              <button type="button" className="modal-close" onClick={closeProductForm}>
                ×
              </button>
            </div>

            <form className="product-form" onSubmit={submitProductForm}>
              <label>
                Nama Produk
                <input
                  type="text"
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  placeholder="Contoh: Sosis Champ 375gr"
                />
              </label>

              <label>
                Kategori
                <input
                  type="text"
                  value={productCategory}
                  onChange={(event) => setProductCategory(event.target.value)}
                  placeholder="Contoh: Sosis"
                />
              </label>

              <label>
                Harga Jual
                <input
                  type="number"
                  min="1"
                  value={productPrice}
                  onChange={(event) => setProductPrice(event.target.value)}
                  placeholder="Contoh: 24500"
                />
              </label>

              <label>
                Satuan
                <input
                  type="text"
                  value={productUnit}
                  onChange={(event) => setProductUnit(event.target.value)}
                  placeholder="pcs, pack, ball"
                />
              </label>

              <div className="product-form-actions">
                <button type="button" className="secondary-button" onClick={closeProductForm}>
                  Batal
                </button>

                <button type="submit" className="finish-button">
                  {editingProduct ? "Simpan Perubahan" : "Simpan Produk"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {selectedVariantProduct ? (
  <div className="modal-backdrop">
    <div className="variant-modal">
      <div className="modal-header">
        <div>
          <h3>Varian Produk</h3>
          <p>{selectedVariantProduct.name}</p>
        </div>

        <button type="button" className="modal-close" onClick={closeVariantModal}>
          ×
        </button>
      </div>

      <div className="variant-list">
        {productVariants
          .filter((variant) => variant.productId === selectedVariantProduct.id)
          .map((variant) => (
            <div
              key={variant.id}
              className={variant.active ? "variant-item" : "variant-item inactive"}
            >
              <div>
                <strong>{variant.name}</strong>
                <p>
                  Mengurangi stok {variant.qtyMultiplier} {selectedVariantProduct.unit} •{" "}
                  {formatRupiah(variant.price)}
                </p>
              </div>

              <div className="variant-actions">
                <span className={variant.active ? "product-status active" : "product-status inactive"}>
                  {variant.active ? "Aktif" : "Nonaktif"}
                </span>

                <button
                  type="button"
                  className="small-edit-button"
                  onClick={() => openEditVariantForm(variant)}
                >
                  Edit
                </button>

                {variant.active ? (
                  <button
                    type="button"
                    className="small-danger-button"
                    onClick={() => onDeactivateProductVariant(variant.id)}
                  >
                    Nonaktifkan
                  </button>
                ) : (
                  <button
                    type="button"
                    className="small-activate-button"
                    onClick={() => onActivateProductVariant(variant.id)}
                  >
                    Aktifkan
                  </button>
                )}
              </div>
            </div>
          ))}

        {productVariants.filter((variant) => variant.productId === selectedVariantProduct.id).length === 0 ? (
          <div className="empty-state">
            Produk ini belum memiliki varian.
          </div>
        ) : null}
      </div>

      <form className="variant-form" onSubmit={submitVariantForm}>
        <h4>{editingVariant ? "Edit Varian" : "Tambah Varian"}</h4>

        <label>
          Nama Varian
          <input
            type="text"
            value={variantName}
            onChange={(event) => setVariantName(event.target.value)}
            placeholder="Contoh: Paket 10 pcs"
          />
        </label>

        <label>
          Qty Multiplier
          <input
            type="number"
            min="1"
            value={variantQtyMultiplier}
            onChange={(event) => setVariantQtyMultiplier(event.target.value)}
            placeholder="Contoh: 10"
          />
        </label>

        <label>
          Harga Jual Varian
          <input
            type="number"
            min="1"
            value={variantPrice}
            onChange={(event) => setVariantPrice(event.target.value)}
            placeholder="Contoh: 9000"
          />
        </label>

        <div className="variant-form-actions">
          {editingVariant ? (
            <button type="button" className="secondary-button" onClick={resetVariantForm}>
              Batal Edit
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={closeVariantModal}>
              Tutup
            </button>
          )}

          <button type="submit" className="finish-button">
            {editingVariant ? "Simpan Varian" : "Tambah Varian"}
          </button>
        </div>
      </form>
    </div>
  </div>
) : null}
    </div>
  );
}

function InventoryPage({ products, stockBatches, onAddStockBatch }) {

  const [isBatchFormOpen, setIsBatchFormOpen] = useState(false);
  const [batchProductId, setBatchProductId] = useState("");
  const [batchPurchaseDate, setBatchPurchaseDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [batchQty, setBatchQty] = useState("");
  const [batchCost, setBatchCost] = useState("");

  const activeProducts = products.filter((product) => product.active);

  const productStockSummary = activeProducts
    .map((product) => {
      const productBatches = stockBatches.filter(
        (batch) => batch.productId === product.id
      );

      const totalStock = productBatches.reduce(
        (total, batch) => total + Number(batch.qtyRemaining || 0),
        0
      );

      const totalStockValue = productBatches.reduce(
        (total, batch) =>
          total + Number(batch.qtyRemaining || 0) * Number(batch.cost || 0),
        0
      );

      function exportStockBatchesCsv() {
  if (stockBatches.length === 0) {
    alert("Belum ada batch stok untuk diexport.");
    return;
  }

  const rows = [
    [
      "Produk",
      "Kategori",
      "Kode Batch",
      "Tanggal Masuk",
      "Harga Modal",
      "Qty Awal",
      "Qty Sisa",
      "Nilai Stok Sisa",
      "Status",
    ],
  ];

  stockBatches.forEach((batch) => {
    const product = products.find((item) => item.id === batch.productId);
    const qtyRemaining = Number(batch.qtyRemaining || 0);
    const cost = Number(batch.cost || 0);

    rows.push([
      product ? product.name : "Produk tidak ditemukan",
      product ? product.category : "-",
      batch.batchCode,
      batch.purchaseDate,
      cost,
      batch.qtyInitial,
      qtyRemaining,
      qtyRemaining * cost,
      qtyRemaining > 0 ? "Aktif" : "Habis",
    ]);
  });

  const now = new Date();
  const filename =
    "stok-fifo-ttm-" +
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0") +
    ".csv";

  downloadCsvFile(filename, rows);
}

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        totalStock: totalStock,
        totalStockValue: totalStockValue,
        batchCount: productBatches.length,
      };
    })
    .sort((a, b) =>
  String(a.name || "").localeCompare(String(b.name || ""), "id-ID", {
    sensitivity: "base",
    numeric: true,
  })
);

  const sortedBatches = stockBatches
    .map((batch) => {
      const product = products.find((item) => item.id === batch.productId);

      return {
        ...batch,
        productName: product ? product.name : "Produk tidak ditemukan",
        productCategory: product ? product.category : "-",
      };
    })
    .sort((a, b) => {
      const productCompare = String(a.productName || "").localeCompare(
  String(b.productName || ""),
  "id-ID",
  {
    sensitivity: "base",
    numeric: true,
  }
);

      if (productCompare !== 0) {
        return productCompare;
      }

      const dateA = new Date(a.purchaseDate).getTime();
      const dateB = new Date(b.purchaseDate).getTime();

      if (dateA !== dateB) {
        return dateA - dateB;
      }

      return Number(a.id) - Number(b.id);
    });

  const totalAllStock = productStockSummary.reduce(
    (total, product) => total + product.totalStock,
    0
  );

  const totalInventoryValue = productStockSummary.reduce(
    (total, product) => total + product.totalStockValue,
    0
  );

  const activeBatchCount = stockBatches.filter(
    (batch) => Number(batch.qtyRemaining || 0) > 0
  ).length;

function resetBatchForm() {
  setBatchProductId("");
  setBatchPurchaseDate(new Date().toISOString().slice(0, 10));
  setBatchQty("");
  setBatchCost("");
}

function submitStockBatch(event) {
  event.preventDefault();

  const selectedProductId = Number(batchProductId);
  const qty = Number(batchQty || 0);
  const cost = Number(batchCost || 0);

  if (!selectedProductId) {
    alert("Pilih produk terlebih dahulu.");
    return;
  }

  if (qty <= 0) {
    alert("Qty masuk harus lebih dari 0.");
    return;
  }

  if (cost <= 0) {
    alert("Harga modal harus lebih dari 0.");
    return;
  }

  const newBatch = {
    id: Date.now(),
    productId: selectedProductId,
    batchCode: createStockBatchCode(stockBatches),
    purchaseDate: batchPurchaseDate,
    qtyInitial: qty,
    qtyRemaining: qty,
    cost: cost,
  };

  onAddStockBatch(newBatch);

  alert("Batch stok berhasil ditambahkan: " + newBatch.batchCode);

  closeBatchForm();
}

function closeBatchForm() {
  setIsBatchFormOpen(false);
  resetBatchForm();
}

function exportStockBatchesCsv() {
  if (stockBatches.length === 0) {
    alert("Belum ada batch stok untuk diexport.");
    return;
  }

  const rows = [
    [
      "Produk",
      "Kategori",
      "Kode Batch",
      "Tanggal Masuk",
      "Harga Modal",
      "Qty Awal",
      "Qty Sisa",
      "Nilai Stok Sisa",
      "Status",
    ],
  ];

  stockBatches.forEach((batch) => {
    const product = products.find((item) => item.id === batch.productId);
    const qtyRemaining = Number(batch.qtyRemaining || 0);
    const cost = Number(batch.cost || 0);

    rows.push([
      product ? product.name : "Produk tidak ditemukan",
      product ? product.category : "-",
      batch.batchCode,
      batch.purchaseDate,
      cost,
      batch.qtyInitial,
      qtyRemaining,
      qtyRemaining * cost,
      qtyRemaining > 0 ? "Aktif" : "Habis",
    ]);
  });

  const now = new Date();
  const filename =
    "stok-fifo-ttm-" +
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0") +
    ".csv";

  downloadCsvFile(filename, rows);
}

  return (
    <div>
      <div className="inventory-header">
  <div>
    <h3>Stok FIFO</h3>
    <p className="muted">
      Semua stok produk dihitung dari batch FIFO yang masih memiliki qty sisa.
    </p>
  </div>

  <div className="inventory-header-actions">
    <button
      type="button"
      className="secondary-button"
      onClick={exportStockBatchesCsv}
    >
      Export CSV
    </button>

    <button
      type="button"
      className="primary-action-button"
      onClick={() => setIsBatchFormOpen(true)}
    >
      Tambah Batch
    </button>
  </div>
</div>

      <div className="inventory-summary">
        <div>
          <span>Total Produk Aktif</span>
          <strong>{activeProducts.length}</strong>
        </div>

        <div>
          <span>Total Qty Stok</span>
          <strong>{totalAllStock}</strong>
        </div>

        <div>
          <span>Batch Aktif</span>
          <strong>{activeBatchCount}</strong>
        </div>

        <div>
          <span>Nilai Stok FIFO</span>
          <strong>{formatRupiah(totalInventoryValue)}</strong>
        </div>
      </div>

      <div className="inventory-section">
        <div className="section-title">
          <h4>Ringkasan Stok per Produk</h4>
          <p>Total stok dihitung dari seluruh batch produk tersebut.</p>
        </div>

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Kategori</th>
                <th>Jumlah Batch</th>
                <th>Total Stok</th>
                <th>Nilai Stok</th>
              </tr>
            </thead>

            <tbody>
              {productStockSummary.map((product) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.category}</td>
                  <td>{product.batchCount}</td>
                  <td>
                    <strong>{product.totalStock}</strong>
                  </td>
                  <td>{formatRupiah(product.totalStockValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="inventory-section">
        <div className="section-title">
          <h4>Daftar Batch FIFO</h4>
          <p>Batch paling lama akan dipakai lebih dulu saat transaksi.</p>
        </div>

        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Kode Batch</th>
                <th>Tanggal Masuk</th>
                <th>Modal</th>
                <th>Qty Awal</th>
                <th>Qty Sisa</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {sortedBatches.map((batch) => {
                const qtyRemaining = Number(batch.qtyRemaining || 0);
                const isEmpty = qtyRemaining <= 0;

                return (
                  <tr key={batch.id} className={isEmpty ? "empty-batch-row" : ""}>
                    <td>
                      <strong>{batch.productName}</strong>
                      <span>{batch.productCategory}</span>
                    </td>
                    <td>{batch.batchCode}</td>
                    <td>
                      {new Date(batch.purchaseDate).toLocaleDateString("id-ID", {
                        dateStyle: "medium",
                      })}
                    </td>
                    <td>{formatRupiah(batch.cost)}</td>
                    <td>{batch.qtyInitial}</td>
                    <td>
                      <strong>{batch.qtyRemaining}</strong>
                    </td>
                    <td>
                      <span className={isEmpty ? "batch-status empty" : "batch-status active"}>
                        {isEmpty ? "Habis" : "Aktif"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sortedBatches.length === 0 ? (
          <div className="empty-state">
            Belum ada batch stok.
          </div>
        ) : null}
      </div>

      {isBatchFormOpen ? (
        <div className="modal-backdrop">
          <div className="stock-batch-modal">
            <div className="modal-header">
              <div>
                <h3>Tambah Batch FIFO</h3>
                <p>Input pembelian barang masuk untuk menambah stok.</p>
              </div>

              <button type="button" className="modal-close" onClick={closeBatchForm}>
                ×
              </button>
            </div>

            <form className="batch-form" onSubmit={submitStockBatch}>
              <label>
                Produk
                <select
                  value={batchProductId}
                  onChange={(event) => setBatchProductId(event.target.value)}
                >
                  <option value="">Pilih produk</option>
                  {activeProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </label>
              
              <label>
                Tanggal Masuk
                <input
                  type="date"
                  value={batchPurchaseDate}
                  onChange={(event) => setBatchPurchaseDate(event.target.value)}
                />
              </label>

              <label>
                Qty Masuk
                <input
                  type="number"
                  min="1"
                  value={batchQty}
                  onChange={(event) => setBatchQty(event.target.value)}
                  placeholder="Contoh: 20"
                />
              </label>

              <label>
                Harga Modal per Unit
                <input
                  type="number"
                  min="1"
                  value={batchCost}
                  onChange={(event) => setBatchCost(event.target.value)}
                  placeholder="Contoh: 20500"
                />
              </label>

              <div className="stock-batch-actions">
                <button type="button" className="secondary-button" onClick={closeBatchForm}>
                  Batal
                </button>

                <button type="submit" className="finish-button">
                  Simpan Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

    </div>
  );
}

function TransactionsPage({
  transactions,
  settings,
  currentRole,
  onClearTransactions,
  onRetrySingleTransactionSync,
  onCancelTransaction,
}) {
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [historyPeriod, setHistoryPeriod] = useState("all");
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  function exportTransactionsCsv() {
  if (transactions.length === 0) {
    alert("Belum ada transaksi untuk diexport.");
    return;
  }

  const rows = [
    [
      "Kode Transaksi",
      "Tanggal",
      "Metode Bayar",
      "Nama Item",
      "Qty Jual",
      "Qty FIFO Keluar",
      "Harga",
      "Subtotal Item",
      "Modal FIFO Item",
      "Profit Item",
      "Subtotal Transaksi",
      "Diskon",
      "Total",
      "Uang Diterima",
      "Kembalian",
      "Profit Transaksi",
    ],
  ];

  transactions.forEach((transaction) => {
    transaction.items.forEach((item) => {
      rows.push([
        transaction.code,
        new Date(transaction.date).toLocaleString("id-ID"),
        transaction.paymentMethod,
        item.name,
        item.qty,
        item.fifoQty || item.qty,
        item.price,
        item.subtotal,
        item.totalCost || 0,
        item.profit || 0,
        transaction.subtotal || 0,
        transaction.discount || 0,
        transaction.total || 0,
        transaction.cashReceived || 0,
        transaction.change || 0,
        transaction.profit || 0,
      ]);
    });
  });

  const now = new Date();
  const filename =
    "transaksi-ttm-" +
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0") +
    ".csv";

  downloadCsvFile(filename, rows);
}

function openCancelModal(transaction) {
  setCancelTarget(transaction);
  setCancelReason("");
}

function closeCancelModal() {
  setCancelTarget(null);
  setCancelReason("");
}

async function submitCancelTransaction(event) {
  event.preventDefault();

  const success = await onCancelTransaction(cancelTarget, cancelReason);

  if (success) {
    closeCancelModal();
  }
}

  function isHistoryTransactionInPeriod(transactionDate, period) {
  const date = new Date(transactionDate);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  if (period === "daily") {
    return date >= startOfToday && date < startOfTomorrow;
  }

  if (period === "weekly") {
    const startOfWeek = new Date(startOfToday);
    const day = startOfWeek.getDay();
    const diff = day === 0 ? 6 : day - 1;
    startOfWeek.setDate(startOfWeek.getDate() - diff);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    return date >= startOfWeek && date < endOfWeek;
  }

  if (period === "monthly") {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth()
    );
  }

  if (period === "yearly") {
    return date.getFullYear() === now.getFullYear();
  }

  return true;
}

function openEditTransaction(transaction) {
  alert(
    "Edit transaksi " +
      transaction.code +
      " akan dibuat pada tahap berikutnya.\n\nKonsep aman: transaksi lama dibatalkan lalu dibuat transaksi pengganti."
  );
}

const filteredTransactions = transactions.filter((transaction) =>
  isHistoryTransactionInPeriod(transaction.date, historyPeriod)
);

const activeFilteredTransactions = filteredTransactions.filter(
  (transaction) => transaction.status !== "cancelled"
);

const totalOmzet = activeFilteredTransactions.reduce(
  (total, transaction) => total + Number(transaction.total || 0),
  0
);

const totalProfit = activeFilteredTransactions.reduce(
  (total, transaction) => total + Number(transaction.profit || 0),
  0
);

const totalTransactionCount = activeFilteredTransactions.length;

  return (
    <div>
      <div className="history-header">
        <div>
          <h3>Riwayat Transaksi</h3>
          <p className="muted">
            Transaksi sementara tersimpan di browser selama tahap development.
          </p>
        </div>

        <div className="transaction-header-actions">
  {transactions.length > 0 ? (
    <div className="history-export-actions">
      <button
        type="button"
        className="secondary-button"
        onClick={exportTransactionsCsv}
      >
        Export CSV
      </button>

      {currentRole === "admin" ? (
  <button
    type="button"
    className="danger-button"
    onClick={onClearTransactions}
  >
    Hapus Riwayat
  </button>
) : null}
    </div>
  ) : null}
</div>
      </div>

      <div className="history-summary">
  <div>
    <span>Total Transaksi</span>
    <strong>{filteredTransactions.length}</strong>
  </div>

  <div>
    <span>Total Omzet</span>
    <strong>{formatRupiah(totalOmzet)}</strong>
  </div>

  <div>
    <span>Total Profit</span>
    <strong>{formatRupiah(totalProfit)}</strong>
  </div>

  <div className="history-period-card">
    <span>Filter Periode</span>

    <div className="history-filter">
      <button
        type="button"
        className={historyPeriod === "daily" ? "active" : ""}
        onClick={() => setHistoryPeriod("daily")}
      >
        Harian
      </button>

      <button
        type="button"
        className={historyPeriod === "weekly" ? "active" : ""}
        onClick={() => setHistoryPeriod("weekly")}
      >
        Mingguan
      </button>

      <button
        type="button"
        className={historyPeriod === "monthly" ? "active" : ""}
        onClick={() => setHistoryPeriod("monthly")}
      >
        Bulanan
      </button>

      <button
        type="button"
        className={historyPeriod === "yearly" ? "active" : ""}
        onClick={() => setHistoryPeriod("yearly")}
      >
        Tahunan
      </button>

      <button
        type="button"
        className={historyPeriod === "all" ? "active" : ""}
        onClick={() => setHistoryPeriod("all")}
      >
        Semua
      </button>
    </div>
  </div>
</div>

      <div className="transaction-list">
        {filteredTransactions.map((transaction) => (
          <div key={transaction.id} className="transaction-card">
            <div className="transaction-card-header">
              <div>
                <h4>{transaction.code}</h4>

                <span
                      className={
                        transaction.syncStatus === "synced"
                          ? "sync-badge synced"
                          : transaction.syncStatus === "failed"
                            ? "sync-badge failed"
                            : "sync-badge pending"
                      }
                    >
                      {transaction.syncStatus === "synced"
                        ? "Tersinkron"
                        : transaction.syncStatus === "failed"
                          ? "Gagal Sinkron"
                          : "Menunggu Sinkron"}
                    </span>
                <p>
                  {new Date(transaction.date).toLocaleString("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>

              <div className="transaction-header-actions">
                <strong>{formatRupiah(transaction.total)}</strong>

                <button
  className="detail-button"
  onClick={() => setSelectedTransaction(transaction)}
>
  Detail
</button>

{currentRole === "admin" && transaction.status !== "cancelled" ? (
  <>
    <button
      className="action-button edit"
      onClick={() => openEditTransaction(transaction)}
    >
      Edit
    </button>

    <button
      className="action-button cancel"
      onClick={() => openCancelModal(transaction)}
    >
      Batalkan
    </button>
  </>
) : null}
              </div>
            </div>

            <div className="transaction-items">
              {transaction.items.map((item) => (
  <li key={item.cartItemId || item.id}>
    <span>
      {item.name} x {item.qty}
      {Number(item.qtyMultiplier || 1) > 1
        ? " (" + Number(item.fifoQty || 0) + " " + item.unit + " keluar)"
        : ""}
    </span>

    <strong>{formatRupiah(item.subtotal)}</strong>
  </li>
))}
            </div>

            <div className="transaction-payment">
              <div>
                <span>Bayar</span>
                <strong>{formatRupiah(transaction.cashReceived)}</strong>
              </div>

              <div>
                <span>Kembalian</span>
                <strong>{formatRupiah(transaction.change)}</strong>
              </div>

              <div>
                <span>Profit</span>
                <strong>{formatRupiah(transaction.profit)}</strong>
              </div>
            </div>
          </div>
        ))}

        {transactions.length === 0 ? (
  <div className="empty-state">
    Belum ada transaksi. Coba lakukan transaksi dari halaman Kasir.
  </div>
) : null}

{transactions.length > 0 && filteredTransactions.length === 0 ? (
  <div className="empty-state">
    Tidak ada transaksi pada periode ini.
  </div>
) : null}
      </div>

      {selectedTransaction ? (
        <TransactionDetailModal
          transaction={selectedTransaction}
          settings={settings}
          onClose={() => setSelectedTransaction(null)}
          onRetrySingleTransactionSync={onRetrySingleTransactionSync}
        />
      ) : null}

      {cancelTarget ? (
  <div className="modal-backdrop">
    <form className="cancel-modal" onSubmit={submitCancelTransaction}>
      <div className="modal-header">
        <div>
          <h3>Batalkan Transaksi</h3>
          <p>{cancelTarget.code}</p>
        </div>

        <button type="button" onClick={closeCancelModal}>
          ×
        </button>
      </div>

      <div className="cancel-summary-box">
        <div>
          <span>Total Awal</span>
          <strong>
            {formatRupiah(cancelTarget.originalTotal || cancelTarget.total || 0)}
          </strong>
        </div>

        <div>
          <span>Profit Awal</span>
          <strong>
            {formatRupiah(cancelTarget.originalProfit || cancelTarget.profit || 0)}
          </strong>
        </div>
      </div>

      <div className="cancel-reason">
        <label>
          Alasan Pembatalan
          <textarea
            value={cancelReason}
            onChange={(event) => setCancelReason(event.target.value)}
            placeholder="Contoh: salah input qty, transaksi double, customer batal..."
            autoFocus
          />
        </label>
      </div>

      <div className="modal-actions">
        <button type="button" className="cancel" onClick={closeCancelModal}>
          Kembali
        </button>

        <button type="submit" className="confirm danger">
          Batalkan Transaksi
        </button>
      </div>
    </form>
  </div>
) : null}
    </div>
  );
}

function TransactionDetailModal({ transaction, settings, onClose, onRetrySingleTransactionSync }) {
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  return (
    <div className="modal-backdrop">
      <div className="transaction-detail-modal">
        <div className="modal-header">
          <div>
            <h3>Detail Transaksi</h3>
            <p>{transaction.code}</p>
          </div>

          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="detail-info-grid">
          <div>
            <span>Tanggal</span>
            <strong>
              {new Date(transaction.date).toLocaleString("id-ID", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </strong>
          </div>

          <div>
            <span>Metode Bayar</span>
            <strong>{transaction.paymentMethod}</strong>
          </div>
        </div>

        <div className="detail-item-list">
          <h4>Item Transaksi</h4>

          {transaction.items.map((item) => (
  <div key={item.cartItemId || item.id} className="detail-item">
    <div>
      <strong>{item.name}</strong>

      {item.variantName ? (
        <p>
          Produk utama: {item.productName}
        </p>
      ) : null}

      <p>
        Qty jual: {item.qty} x {formatRupiah(item.price)}
      </p>

      <p>
        Qty FIFO keluar: {Number(item.fifoQty || item.qty)} {item.unit}
      </p>

      <p>
        Modal FIFO: {formatRupiah(item.totalCost || 0)}
      </p>

      <p>
        Profit item: {formatRupiah(item.profit || 0)}
      </p>

      {item.fifoBatches && item.fifoBatches.length > 0 ? (
        <div className="fifo-batch-list">
          <span>Batch FIFO:</span>

          {item.fifoBatches.map((batch) => (
            <small key={batch.batchId}>
              {batch.batchCode} - {batch.qty} {item.unit} x {formatRupiah(batch.cost)}
            </small>
          ))}
        </div>
      ) : null}
    </div>

    <strong>{formatRupiah(item.subtotal)}</strong>
  </div>
))}
        </div>

        <div className="detail-total-list">
          <div>
            <span>Subtotal</span>
            <strong>{formatRupiah(transaction.subtotal)}</strong>
          </div>

          <div>
            <span>Diskon</span>
            <strong>{formatRupiah(transaction.discount)}</strong>
          </div>

          <div>
            <span>Total</span>
            <strong>{formatRupiah(transaction.total)}</strong>
          </div>

          <div>
            <span>Uang Diterima</span>
            <strong>{formatRupiah(transaction.cashReceived)}</strong>
          </div>

          <div>
            <span>Kembalian</span>
            <strong>{formatRupiah(transaction.change)}</strong>
          </div>

          <div>
            <span>Profit</span>
            <strong>{formatRupiah(transaction.profit)}</strong>
          </div>
        </div>

        {transaction.syncStatus === "failed" ? (
  <div className="sync-error-box">
    <div>
      <strong>Gagal Sinkron Supabase</strong>
      <p>{transaction.syncError || "Tidak ada detail error."}</p>
    </div>

    <button
      type="button"
      className="secondary-button"
      onClick={() => onRetrySingleTransactionSync(transaction)}
    >
      Sinkron Ulang
    </button>
  </div>
) : null}

        <div className="detail-actions">
  <button
    type="button"
    className="secondary-button"
    onClick={() => setIsReceiptOpen(true)}
  >
    Lihat Struk
  </button>

  <button type="button" className="finish-button" onClick={onClose}>
    Tutup
  </button>
</div>
      </div>

      {isReceiptOpen ? (
  <ReceiptModal
    transaction={transaction}
    settings={settings}
    onClose={() => setIsReceiptOpen(false)}
  />
) : null}
    </div>
  );
}

function ReceiptModal({ transaction, settings, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="receipt-modal">
        <div className="modal-header">
  <div>
    <h3>Transaksi Berhasil</h3>
    <p>{transaction.code} • cetak atau lewati struk</p>
  </div>

          <button type="button" className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="receipt-paper printable-receipt">
          <div className="receipt-store">
  <p className="receipt-business-type">AGEN SOSIS DAN ES KRISTAL</p>
  <h4>{settings.storeName}</h4>

  {settings.address ? <p>{settings.address}</p> : null}
          </div>

          <div className="receipt-line" />

          <div className="receipt-meta">
            <div>
              <span>No</span>
              <strong>{transaction.code}</strong>
            </div>

            <div>
              <span>Tgl</span>
              <strong>
                {new Date(transaction.date).toLocaleString("id-ID", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </strong>
            </div>

            <div>
              <span>Bayar</span>
              <strong>{transaction.paymentMethod}</strong>
            </div>

            {transaction.cashierName ? (
  <div>
    <span>Kasir</span>
    <strong>{transaction.cashierName}</strong>
  </div>
) : null}
          </div>

          <div className="receipt-line" />

          <div className="receipt-items">
            {transaction.items.map((item) => (
              <div key={item.cartItemId || item.id} className="receipt-item">
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    {item.qty} x {formatRupiah(item.price)}
                  </span>
                </div>

                <strong>{formatRupiah(item.subtotal)}</strong>
              </div>
            ))}
          </div>

          <div className="receipt-line" />

          <div className="receipt-total">
            <div>
              <span>Subtotal</span>
              <strong>{formatRupiah(transaction.subtotal || 0)}</strong>
            </div>

            <div>
              <span>Diskon</span>
              <strong>{formatRupiah(transaction.discount || 0)}</strong>
            </div>

            <div className="receipt-grand-total">
              <span>Total</span>
              <strong>{formatRupiah(transaction.total || 0)}</strong>
            </div>

            <div>
              <span>Tunai</span>
              <strong>{formatRupiah(transaction.cashReceived || 0)}</strong>
            </div>

            <div>
              <span>Kembali</span>
              <strong>{formatRupiah(transaction.change || 0)}</strong>
            </div>
          </div>

          <div className="receipt-line" />

          <div className="receipt-note">
  <p>{settings.receiptNote || "Terima kasih sudah belanja."}</p>

  {settings.phone ? (
    <>
      <p>Pemesanan / info produk:</p>
      <p>{formatWhatsAppNumber(settings.phone)}</p>
    </>
  ) : null}
</div>
        </div>

        <div className="receipt-actions">
  <button type="button" className="secondary-button" onClick={onClose}>
    Lewati Struk
  </button>

  <button
  type="button"
  className="finish-button"
  onClick={async () => {
    try {
      await printThermalReceiptQz(transaction, settings);
      onClose();
    } catch (error) {
      alert("Gagal cetak QZ: " + (error?.message || error));
    }
  }}
>
  Cetak Struk
</button>
</div>
      </div>
    </div>
  );
}

function ReportsPage({ transactions, cashierClosings }) {
  const [reportPeriod, setReportPeriod] = useState("all")
  function isTransactionInPeriod(transactionDate, period) {
  const date = new Date(transactionDate);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  if (period === "today") {
    return date >= startOfToday && date < startOfTomorrow;
  }

  if (period === "week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() + diffToMonday);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    return date >= startOfWeek && date < endOfWeek;
  }

  if (period === "month") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    return date >= startOfMonth && date < startOfNextMonth;
  }

  if (period === "year") {
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);

    return date >= startOfYear && date < startOfNextYear;
  }

  return true;
}

const filteredTransactions = transactions.filter((transaction) =>
  isTransactionInPeriod(transaction.date, reportPeriod)
);

const filteredCashierClosings = (cashierClosings || []).filter((closing) =>
  isTransactionInPeriod(closing.closedAt, reportPeriod)
);

const totalClosingCashIn = filteredCashierClosings.reduce(
  (total, closing) => total + Number(closing.cashInTotal || 0),
  0
);

const totalClosingCashOut = filteredCashierClosings.reduce(
  (total, closing) => total + Number(closing.cashOutTotal || 0),
  0
);

const totalClosingDifference = filteredCashierClosings.reduce(
  (total, closing) => total + Number(closing.difference || 0),
  0
);

  const totalRevenue = filteredTransactions.reduce(
    (total, transaction) => total + Number(transaction.total || 0),
    0
  );

  const totalSubtotal = filteredTransactions.reduce(
    (total, transaction) => total + Number(transaction.subtotal || 0),
    0
  );

  const totalDiscount = filteredTransactions.reduce(
    (total, transaction) => total + Number(transaction.discount || 0),
    0
  );

  const totalProfit = filteredTransactions.reduce(
    (total, transaction) => total + Number(transaction.profit || 0),
    0
  );

  const totalItemsSold = filteredTransactions.reduce((total, transaction) => {
    const transactionQty = transaction.items.reduce(
      (itemTotal, item) => itemTotal + Number(item.qty || 0),
      0
    );

    return total + transactionQty;
  }, 0);

  const totalFifoQtySold = filteredTransactions.reduce((total, transaction) => {
    const transactionFifoQty = transaction.items.reduce(
      (itemTotal, item) =>
        itemTotal + Number(item.fifoQty || item.qty || 0),
      0
    );

    return total + transactionFifoQty;
  }, 0);

  const productSalesMap = {};

  filteredTransactions.forEach((transaction) => {
    transaction.items.forEach((item) => {
      const key = item.name;

      if (!productSalesMap[key]) {
        productSalesMap[key] = {
          name: item.name,
          qty: 0,
          fifoQty: 0,
          revenue: 0,
          profit: 0,
        };
      }

      productSalesMap[key].qty =
        productSalesMap[key].qty + Number(item.qty || 0);

      productSalesMap[key].fifoQty =
        productSalesMap[key].fifoQty + Number(item.fifoQty || item.qty || 0);

      productSalesMap[key].revenue =
        productSalesMap[key].revenue + Number(item.subtotal || 0);

      productSalesMap[key].profit =
        productSalesMap[key].profit + Number(item.profit || 0);
    });
  });

  const topProducts = Object.values(productSalesMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const averageTransactionValue =
    filteredTransactions.length > 0 ? totalRevenue / filteredTransactions.length : 0;

  return (
    <div>
      <div className="reports-header">
  <div>
    <h3>Laporan</h3>
    <p className="muted">
      Ringkasan transaksi lokal berdasarkan riwayat penjualan dan modal FIFO.
    </p>
  </div>

  <div className="report-filter-tabs">
    <button
      type="button"
      className={reportPeriod === "today" ? "active" : ""}
      onClick={() => setReportPeriod("today")}
    >
      Hari Ini
    </button>

    <button
      type="button"
      className={reportPeriod === "week" ? "active" : ""}
      onClick={() => setReportPeriod("week")}
    >
      Minggu Ini
    </button>

    <button
      type="button"
      className={reportPeriod === "month" ? "active" : ""}
      onClick={() => setReportPeriod("month")}
    >
      Bulan Ini
    </button>

    <button
      type="button"
      className={reportPeriod === "year" ? "active" : ""}
      onClick={() => setReportPeriod("year")}
    >
      Tahun Ini
    </button>

    <button
      type="button"
      className={reportPeriod === "all" ? "active" : ""}
      onClick={() => setReportPeriod("all")}
    >
      Semua
    </button>
  </div>
</div>

      <div className="reports-summary">
        <div>
          <span>Total Omzet</span>
          <strong>{formatRupiah(totalRevenue)}</strong>
        </div>

        <div>
          <span>Total Profit FIFO</span>
          <strong>{formatRupiah(totalProfit)}</strong>
        </div>

        <div>
          <span>Total Diskon</span>
          <strong>{formatRupiah(totalDiscount)}</strong>
        </div>

        <div>
          <span>Jumlah Transaksi</span>
          <strong>{filteredTransactions.length}</strong>
        </div>

        <div>
          <span>Subtotal Sebelum Diskon</span>
          <strong>{formatRupiah(totalSubtotal)}</strong>
        </div>

        <div>
          <span>Rata-rata Transaksi</span>
          <strong>{formatRupiah(averageTransactionValue)}</strong>
        </div>

        <div>
          <span>Qty Jual</span>
          <strong>{totalItemsSold}</strong>
        </div>

        <div>
          <span>Qty FIFO Keluar</span>
          <strong>{totalFifoQtySold}</strong>
        </div>
        <div>
  <span>Sesi Kasir Ditutup</span>
  <strong>{filteredCashierClosings.length}</strong>
</div>

<div>
  <span>Pemasukan Kasir</span>
  <strong>{formatRupiah(totalClosingCashIn)}</strong>
</div>

<div>
  <span>Pengeluaran Kasir</span>
  <strong>{formatRupiah(totalClosingCashOut)}</strong>
</div>

<div>
  <span>Total Selisih Kasir</span>
  <strong>{formatRupiah(Math.abs(totalClosingDifference))}</strong>
</div>
      </div>

      <div className="reports-section">
  <div className="section-title">
    <h4>Riwayat Tutup Kasir</h4>
    <p>Rekap sesi kasir berdasarkan periode laporan yang dipilih.</p>
  </div>

  <div className="reports-table-wrap">
    <table className="reports-table">
      <thead>
        <tr>
          <th>Tanggal</th>
          <th>Jam</th>
          <th>Modal Awal</th>
          <th>Penjualan</th>
          <th>Pemasukan</th>
          <th>Pengeluaran</th>
          <th>Estimasi</th>
          <th>Fisik</th>
          <th>Status</th>
        </tr>
      </thead>

      <tbody>
        {filteredCashierClosings.slice(0, 20).map((closing) => (
          <tr key={closing.id}>
            <td>
              {new Date(closing.closedAt).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Jakarta",
              })}
            </td>

            <td>
              {new Date(closing.openedAt).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              })}
              {" - "}
              {new Date(closing.closedAt).toLocaleTimeString("id-ID", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
              })}
            </td>

            <td>{formatRupiah(closing.openingCash || 0)}</td>
            <td>{formatRupiah(closing.salesTotal || 0)}</td>
            <td>{formatRupiah(closing.cashInTotal || 0)}</td>
            <td>{formatRupiah(closing.cashOutTotal || 0)}</td>
            <td>{formatRupiah(closing.estimatedClosingCash || 0)}</td>
            <td>{formatRupiah(closing.actualClosingCash || 0)}</td>

            <td>
              <strong>{closing.status}</strong>
              <br />
              <span>
                Selisih {formatRupiah(Math.abs(closing.difference || 0))}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    {filteredCashierClosings.length === 0 ? (
      <div className="empty-state">
        Belum ada riwayat tutup kasir pada periode ini.
      </div>
    ) : null}
  </div>
</div>

<div className="reports-section">
  <div className="section-title">
    <h4>Produk / Varian Terlaris</h4>
    <p>Diurutkan berdasarkan qty jual. Qty FIFO menunjukkan stok asli yang keluar.</p>
  </div>

  <div className="reports-table-wrap">
    <table className="reports-table">
      <thead>
        <tr>
          <th>Produk / Varian</th>
          <th>Qty Jual</th>
          <th>Qty FIFO Keluar</th>
          <th>Omzet</th>
          <th>Profit FIFO</th>
        </tr>
      </thead>

      <tbody>
        {topProducts.map((product) => (
          <tr key={product.name}>
            <td>
              <strong>{product.name}</strong>
            </td>
            <td>{product.qty}</td>
            <td>{product.fifoQty}</td>
            <td>{formatRupiah(product.revenue)}</td>
            <td>{formatRupiah(product.profit)}</td>
          </tr>
        ))}
      </tbody>
    </table>

    {topProducts.length === 0 ? (
      <div className="empty-state">
        Belum ada data transaksi.
      </div>
    ) : null}
  </div>
</div>

      <div className="reports-section">
        <div className="section-title">
          <h4>Transaksi Terbaru</h4>
          <p>Ringkasan transaksi terakhir dari riwayat penjualan.</p>
        </div>

        <div className="reports-table-wrap">
          <table className="reports-table">
            <thead>
              <tr>
                <th>Kode</th>
                <th>Tanggal</th>
                <th>Item</th>
                <th>Diskon</th>
                <th>Total</th>
                <th>Profit</th>
              </tr>
            </thead>

            <tbody>
              {filteredTransactions.slice(0, 10).map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    <strong>{transaction.code}</strong>
                  </td>
                  <td>
                    {new Date(transaction.date).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>{transaction.items.length}</td>
                  <td>{formatRupiah(transaction.discount || 0)}</td>
                  <td>{formatRupiah(transaction.total || 0)}</td>
                  <td>{formatRupiah(transaction.profit || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredTransactions.length === 0 ? (
            <div className="empty-state">
              Belum ada transaksi.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SettingsPage({
  settings,
  products,
  productVariants,
  stockBatches,
  transactions,
  onUpdateSettings,
  onRestoreProducts,
  onRestoreProductVariants,
  onRestoreStockBatches,
  onRestoreTransactions,
  onTestSupabaseConnection,
  onRetryFailedTransactionSync,
  onSyncLocalStockBatchesToSupabase,
  onRefreshAllDataFromSupabase,
}) {
  const [storeName, setStoreName] = useState(settings.storeName);
  const [address, setAddress] = useState(settings.address);
  const [phone, setPhone] = useState(settings.phone);
  const [receiptNote, setReceiptNote] = useState(settings.receiptNote);
  const [lowStockThreshold, setLowStockThreshold] = useState(String(settings.lowStockThreshold));

  function submitSettings(event) {
    event.preventDefault();

    const threshold = Number(lowStockThreshold || 0);

    if (!storeName.trim()) {
      alert("Nama toko wajib diisi.");
      return;
    }

    if (threshold < 0) {
      alert("Batas stok rendah tidak boleh minus.");
      return;
    }

    onUpdateSettings({
      storeName: storeName.trim(),
      address: address.trim(),
      phone: phone.trim(),
      receiptNote: receiptNote.trim(),
      lowStockThreshold: Number(lowStockThreshold || 10),
      autoLoadSupabase: true,
    });

    alert("Pengaturan berhasil disimpan.");
  }

  function exportLocalBackupJson() {
  const backupData = {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    appName: "TTM POS",
    settings: settings,
    products: products,
    productVariants: productVariants,
    stockBatches: stockBatches,
    transactions: transactions,
  };

  const jsonContent = JSON.stringify(backupData, null, 2);

  const blob = new Blob([jsonContent], {
    type: "application/json;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const now = new Date();
  const filename =
    "backup-ttm-pos-" +
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0") +
    ".json";

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function importLocalBackupJson(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const importConfirmation = window.prompt(
  "Import backup akan mengganti data lokal saat ini.\n\nKetik IMPORT untuk melanjutkan."
);

if (importConfirmation !== "IMPORT") {
  event.target.value = "";
  return;
}

  const reader = new FileReader();

  reader.onload = function () {
    try {
      const backupData = JSON.parse(reader.result);

      if (!backupData || typeof backupData !== "object") {
        alert("File backup tidak valid.");
        event.target.value = "";
        return;
      }

      if (!Array.isArray(backupData.products)) {
        alert("File backup tidak memiliki data products yang valid.");
        event.target.value = "";
        return;
      }

      if (!Array.isArray(backupData.productVariants)) {
        alert("File backup tidak memiliki data productVariants yang valid.");
        event.target.value = "";
        return;
      }

      if (!Array.isArray(backupData.stockBatches)) {
        alert("File backup tidak memiliki data stockBatches yang valid.");
        event.target.value = "";
        return;
      }

      if (!Array.isArray(backupData.transactions)) {
        alert("File backup tidak memiliki data transactions yang valid.");
        event.target.value = "";
        return;
      }

      onUpdateSettings({
        ...defaultSettings,
        ...(backupData.settings || {}),
      });

      onRestoreProducts(backupData.products);
      onRestoreProductVariants(backupData.productVariants);
      onRestoreStockBatches(backupData.stockBatches);
      onRestoreTransactions(backupData.transactions);

      alert("Backup berhasil diimport.");
      event.target.value = "";
    } catch {
      alert("Gagal membaca file backup. Pastikan file berupa JSON backup TTM POS.");
      event.target.value = "";
    }
  };

  reader.readAsText(file);
}

  return (
    <div>
      <div className="settings-header">
        <div>
          <h3>Pengaturan</h3>
          <p className="muted">
            Atur identitas toko dan preferensi dasar aplikasi POS.
          </p>
        </div>
      </div>

      <form className="settings-form" onSubmit={submitSettings}>
        <div className="settings-section">
          <div className="section-title">
            <h4>Identitas Toko</h4>
            <p>Data ini nanti dipakai untuk tampilan aplikasi dan struk.</p>
          </div>

          <label>
            Nama Toko
            <input
              type="text"
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              placeholder="Contoh: Toko Telon Mindi"
            />
          </label>

          <label>
            Alamat
            <textarea
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Alamat toko"
              rows="3"
            />
          </label>

          <label>
            Nomor WA / Telepon
            <input
              type="text"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Contoh: 08xxxxxxxxxx"
            />
          </label>
        </div>

        <div className="settings-section">
          <div className="section-title">
            <h4>Struk & Stok</h4>
            <p>Catatan struk dan batas stok rendah untuk Dashboard.</p>
          </div>

          <label>
            Catatan Struk
            <textarea
              value={receiptNote}
              onChange={(event) => setReceiptNote(event.target.value)}
              placeholder="Contoh: Terima kasih sudah belanja."
              rows="3"
            />
          </label>

          <label>
            Batas Stok Rendah
            <input
              type="number"
              min="0"
              value={lowStockThreshold}
              onChange={(event) => setLowStockThreshold(event.target.value)}
              placeholder="Contoh: 10"
            />
          </label>
      </div>

        <div className="settings-section">
  <div className="section-title">
    <h4>Supabase</h4>
    <p>Kelola koneksi dan sinkronisasi data dengan database online.</p>
  </div>

  <div className="settings-button-grid">
    <button
      type="button"
      className="secondary-button"
      onClick={onTestSupabaseConnection}
    >
      Test Supabase
    </button>

    <button
      type="button"
      className="secondary-button"
      onClick={onRefreshAllDataFromSupabase}
    >
      Refresh Data Online
    </button>

    <button
      type="button"
      className="secondary-button"
      onClick={onRetryFailedTransactionSync}
    >
      Sinkron Ulang Gagal
    </button>

    <button
      type="button"
      className="secondary-button"
      onClick={onSyncLocalStockBatchesToSupabase}
    >
      Sinkron Stok
    </button>
  </div>
</div>

<div className="settings-section">
  <div className="section-title">
    <h4>Backup Lokal</h4>
    <p>Export dan import data lokal browser dalam format JSON.</p>
  </div>

  <button
  type="button"
  className="secondary-button"
  onClick={async () => {
    try {
      await printTestReceiptQz({
        ...settings,
        printerName: settings.printerName || "EPPOS",
      });
      alert("Test print QZ berhasil dikirim.");
    } catch (error) {
      alert("Gagal test print QZ: " + (error?.message || error));
    }
  }}
>
  Test Print QZ
</button>

  <div className="settings-button-grid">
    <button
      type="button"
      className="secondary-button"
      onClick={exportLocalBackupJson}
    >
      Export Backup JSON
    </button>

    <label className="import-backup-button">
      Import Backup JSON
      <input
        type="file"
        accept="application/json,.json"
        onChange={importLocalBackupJson}
      />
    </label>
  </div>
</div>

<div className="settings-actions">
  <button type="submit" className="finish-button">
    Simpan Pengaturan
  </button>
</div>
      </form>
    </div>
  );
}

export default App;