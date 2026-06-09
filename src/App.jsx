import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { dummyProducts } from "./db/dummyProducts";
import { dummyStockBatches } from "./db/dummyStockBatches";
import { formatRupiah } from "./lib/format";

const menus = [
  { id: "dashboard", label: "Dashboard" },
  { id: "cashier", label: "Kasir" },
  { id: "products", label: "Produk" },
  { id: "inventory", label: "Stok" },
  { id: "transactions", label: "Riwayat" },
  { id: "reports", label: "Laporan" },
  { id: "settings", label: "Pengaturan" },
];

const TRANSACTIONS_STORAGE_KEY = "ttm_pos_transactions";
const STOCK_BATCHES_STORAGE_KEY = "ttm_pos_stock_batches";

function createTransactionCode(existingTransactions) {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const dateCode = String(year) + month + day;
  const prefix = "TRX-" + dateCode + "-";

  const todayTransactions = existingTransactions.filter((transaction) =>
    transaction.code.startsWith(prefix)
  );

  const nextNumber = todayTransactions.length + 1;
  const sequence = String(nextNumber).padStart(4, "0");

  return prefix + sequence;
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
    let remainingQtyToSell = Number(cartItem.qty || 0);

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

    const subtotal = Number(cartItem.price || 0) * Number(cartItem.qty || 0);

    fifoResultItems.push({
      ...cartItem,
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

function App() {
  const [activePage, setActivePage] = useState("cashier");
  const [products, setProducts] = useState(dummyProducts);
  const [stockBatches, setStockBatches] = useState(() => {
  const savedStockBatches = localStorage.getItem(STOCK_BATCHES_STORAGE_KEY);

  if (!savedStockBatches) {
    return dummyStockBatches;
  }

  try {
    return JSON.parse(savedStockBatches);
  } catch {
    return dummyStockBatches;
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

  const activeMenu = menus.find((menu) => menu.id === activePage);
  const pageTitle = activeMenu ? activeMenu.label : "Kasir";

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

  function addTransaction(transaction, updatedBatches) {
  setTransactions((currentTransactions) => [
    transaction,
    ...currentTransactions,
  ]);

  if (updatedBatches) {
    setStockBatches(updatedBatches);
  }
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
    "Hapus semua riwayat transaksi sementara dan reset stok FIFO?"
  );

  if (confirmClear === false) {
    return;
  }

  setTransactions([]);
  setStockBatches(dummyStockBatches);

  localStorage.removeItem(TRANSACTIONS_STORAGE_KEY);
  localStorage.removeItem(STOCK_BATCHES_STORAGE_KEY);
}

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">TTM</div>
          <div>
            <h1>Toko Telon Mindi</h1>
            <p>POS v2</p>
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
              {menu.label}
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

          <div className="status-pill">Development</div>
        </header>

        <section className="page-card">
          {activePage === "dashboard" ? <DashboardPage /> : null}
          {activePage === "cashier" ? ( 
            <CashierPage 
            products={products}
            stockBatches={stockBatches}
            transactions={transactions}
            onAddTransaction={addTransaction} 
          /> 
          ) : null}
          {activePage === "products" ? <ProductsPage /> : null}
          {activePage === "inventory" ? <InventoryPage /> : null}
          {activePage === "transactions" ? ( 
            <TransactionsPage 
            transactions={transactions}
            onClearTransactions={clearTransactions} 
            /> 
          ) : null}
          {activePage === "reports" ? <ReportsPage /> : null}
          {activePage === "settings" ? <SettingsPage /> : null}
        </section>
      </main>
    </div>
  );
}

function CashierPage({ products, stockBatches, transactions, onAddTransaction }) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [cart, setCart] = useState([]);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");

  const activeProducts = useMemo(() => {
  return products
    .filter((product) => product.active)
    .map((product) => ({
      ...product,
      stock: getProductStockFromBatches(product.id, stockBatches),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}, [products, stockBatches]);

  const categories = useMemo(() => {
    const uniqueCategories = activeProducts.map((product) => product.category);
    return ["Semua", ...new Set(uniqueCategories)];
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
  const changeAmount = numericCashReceived - cartTotal;
  const isPaymentValid =
    cart.length > 0 &&
    !isDiscountTooLarge &&
    numericCashReceived >= cartTotal;

  function addToCart(product) {
    setCart((currentCart) => {
      const existingItem = currentCart.find((item) => item.id === product.id);

      if (existingItem) {
        return currentCart.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }

      return [
        ...currentCart,
        {
          id: product.id,
          name: product.name,
          category: product.category,
          price: product.price,
          cost: product.cost,
          unit: product.unit,
          qty: 1,
        },
      ];
    });
  }

  function increaseQty(productId) {
    setCart((currentCart) =>
      currentCart.map((item) =>
        item.id === productId ? { ...item, qty: item.qty + 1 } : item
      )
    );
  }

  function decreaseQty(productId) {
    setCart((currentCart) =>
      currentCart
        .map((item) =>
          item.id === productId ? { ...item, qty: item.qty - 1 } : item
        )
        .filter((item) => item.qty > 0)
    );
  }

  function clearCart() {
    setCart([]);
    setDiscountAmount("");
  }

  function openPaymentModal() {
  if (cart.length === 0) return;
  if (isDiscountTooLarge) return;

  setCashReceived(String(cartTotal));
  setIsPaymentOpen(true);
}

function closePaymentModal() {
  setIsPaymentOpen(false);
  setCashReceived("");
}

function finishTransaction() {
  console.log("Klik Selesaikan Transaksi");
  console.log("cart:", cart);
  console.log("stockBatches:", stockBatches);
  console.log("isPaymentValid:", isPaymentValid);
  console.log("cartTotal:", cartTotal);
  console.log("numericCashReceived:", numericCashReceived);

  if (!isPaymentValid) {
    alert("Pembayaran belum valid. Cek uang diterima atau diskon.");
    return;
  }

  const fifoResult = processFifoSale(cart, stockBatches);

  console.log("fifoResult:", fifoResult);

  if (!fifoResult.success) {
    alert(fifoResult.message);
    return;
  }

  const now = new Date();
  const transactionId = "TRX-" + now.getTime();
  const transactionCode = createTransactionCode(transactions);

  const totalProfitBeforeDiscount = fifoResult.items.reduce(
    (total, item) => total + item.profit,
    0
  );

  const transaction = {
    id: transactionId,
    code: transactionCode,
    date: now.toISOString(),
    items: fifoResult.items,
    subtotal: cartSubtotal,
    discount: safeDiscountAmount,
    total: cartTotal,
    cashReceived: numericCashReceived,
    change: changeAmount,
    paymentMethod: "Cash",
    profit: totalProfitBeforeDiscount - safeDiscountAmount,
  };

  onAddTransaction(transaction, fifoResult.updatedBatches);

  alert(
    "Transaksi berhasil!\n" +
      "Kode: " +
      transaction.code +
      "\n" +
      "Subtotal: " +
      formatRupiah(transaction.subtotal) +
      "\n" +
      "Diskon: " +
      formatRupiah(transaction.discount) +
      "\n" +
      "Total: " +
      formatRupiah(transaction.total) +
      "\n" +
      "Bayar: " +
      formatRupiah(transaction.cashReceived) +
      "\n" +
      "Kembalian: " +
      formatRupiah(transaction.change)
  );

  setCart([]);
  setCashReceived("");
  setDiscountAmount("");
  setIsPaymentOpen(false);
}

  return (
    <div>
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
                {category}
              </button>
            ))}
          </div>

          <div className="product-grid">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                className="product-card"
                onClick={() => addToCart(product)}
              >
                <div>
                  <h4>{product.name}</h4>
                  <p>{product.category}</p>
                </div>

                <div className="product-card-footer">
                  <strong>{formatRupiah(product.price)}</strong>
                  <span>Stok {product.stock}</span>
                </div>
              </button>
            ))}

            {filteredProducts.length === 0 ? (
              <div className="empty-state">
                Produk tidak ditemukan.
              </div>
            ) : null}
          </div>
        </div>

        <div className="cart-area">
          <div className="cart-header">
            <div>
              <h4>Keranjang</h4>
              <p>{cart.length} jenis produk</p>
            </div>

            {cart.length > 0 ? (
              <button type="button" className="clear-button" onClick={clearCart}>
                Kosongkan
              </button>
            ) : null}
          </div>

          <div className="cart-list">
            {cart.map((item) => (
              <div key={item.id} className="cart-item">
                <div>
                  <h5>{item.name}</h5>
                  <p>
                    {formatRupiah(item.price)} / {item.unit}
                  </p>
                </div>

                <div className="qty-control">
                  <button type="button" onClick={() => decreaseQty(item.id)}>
                    -
                  </button>
                  <span>{item.qty}</span>
                  <button type="button" onClick={() => increaseQty(item.id)}>
                    +
                  </button>
                </div>

                <strong>{formatRupiah(item.price * item.qty)}</strong>
              </div>
            ))}

            {cart.length === 0 ? (
              <div className="empty-cart">
                Keranjang masih kosong.
              </div>
            ) : null}
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

            <div>
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
              disabled={cart.length === 0 || isDiscountTooLarge}
              onClick={openPaymentModal}
            >
              Bayar
            </button>
          </div>
        </div>
      </div>

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

  <label>
    Uang Diterima
    <input
      type="number"
      min="0"
      value={cashReceived}
      onChange={(event) => setCashReceived(event.target.value)}
      autoFocus
    />
  </label>

  <div>
    <span>Kembalian</span>
    <strong className={changeAmount < 0 ? "danger-text" : ""}>
      {formatRupiah(changeAmount)}
    </strong>
  </div>

  {changeAmount < 0 ? (
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
    </div>
  );
}

function DashboardPage() {
  return (
    <div className="empty-page">
      <h3>Dashboard</h3>
      <p>Ringkasan omzet, profit, transaksi, dan produk terlaris nanti muncul di sini.</p>
    </div>
  );
}

function ProductsPage() {
  return (
    <div className="empty-page">
      <h3>Produk</h3>
      <p>Tambah, edit, hapus, kategori, harga jual, harga modal, dan varian produk.</p>
    </div>
  );
}

function InventoryPage() {
  return (
    <div className="empty-page">
      <h3>Stok</h3>
      <p>Manajemen stok sederhana dan FIFO nanti kita susun di sini.</p>
    </div>
  );
}

function TransactionsPage({ transactions, onClearTransactions }) {
  const [selectedTransaction, setSelectedTransaction] = useState(null);

  const totalOmzet = transactions.reduce(
    (total, transaction) => total + transaction.total,
    0
  );

  const totalProfit = transactions.reduce(
    (total, transaction) => total + transaction.profit,
    0
  );

  return (
    <div>
      <div className="history-header">
        <div>
          <h3>Riwayat Transaksi</h3>
          <p className="muted">
            Transaksi sementara tersimpan di browser selama tahap development.
          </p>
        </div>

        {transactions.length > 0 ? (
          <button 
            type="button" 
            className="danger-button" 
            onClick={onClearTransactions}
          >
            Hapus Riwayat
          </button>
        ) : null}
      </div>

      <div className="history-summary">
        <div>
          <span>Total Transaksi</span>
          <strong>{transactions.length}</strong>
        </div>

        <div>
          <span>Total Omzet</span>
          <strong>{formatRupiah(totalOmzet)}</strong>
        </div>

        <div>
          <span>Total Profit</span>
          <strong>{formatRupiah(totalProfit)}</strong>
        </div>
      </div>

      <div className="transaction-list">
        {transactions.map((transaction) => (
          <div key={transaction.id} className="transaction-card">
            <div className="transaction-card-header">
              <div>
                <h4>{transaction.code}</h4>
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
                  type="button"
                  className="detail-button"
                  onClick={() => setSelectedTransaction(transaction)}
                >
                  Detail
                </button>
              </div>
            </div>

            <div className="transaction-items">
              {transaction.items.map((item) => (
                <div key={transaction.id + "-" + item.id}>
                  <span>
                    {item.name} x {item.qty}
                  </span>
                  <strong>{formatRupiah(item.subtotal)}</strong>
                </div>
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
      </div>

      {selectedTransaction ? (
        <TransactionDetailModal
          transaction={selectedTransaction}
          onClose={() => setSelectedTransaction(null)}
        />
      ) : null}
    </div>
  );
}

function TransactionDetailModal({ transaction, onClose }) {
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
            <div key={transaction.id + "-detail-" + item.id} className="detail-item">
              <div>
                <strong>{item.name}</strong>

                <span>
                  {item.qty} x {formatRupiah(item.price)}
                </span>

                <span>
                  Modal FIFO: {formatRupiah(item.totalCost)}
                </span>

                <span>
                  Profit: {formatRupiah(item.profit)}
                </span>

                {item.fifoBatches ? (
                  <div className="fifo-batch-list">
                    {item.fifoBatches.map((batch) => (
                      <span key={item.id + "-batch-" + batch.batchId}>
                        {batch.batchCode} - {batch.qty} pcs x {formatRupiah(batch.cost)}
                      </span>
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

        <div className="detail-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportsPage() {
  return (
    <div className="empty-page">
      <h3>Laporan</h3>
      <p>Laporan harian, mingguan, bulanan, tahunan, omzet, profit, dan produk terjual.</p>
    </div>
  );
}

function SettingsPage() {
  return (
    <div className="empty-page">
      <h3>Pengaturan</h3>
      <p>Nama toko, alamat, nomor WhatsApp, catatan struk, dan pengaturan kasir.</p>
    </div>
  );
}

export default App;