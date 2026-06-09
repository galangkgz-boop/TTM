import { useMemo, useState } from "react";
import "./App.css";
import { dummyProducts } from "./db/dummyProducts";
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

function App() {
  const [activePage, setActivePage] = useState("cashier");

  const activeMenu = menus.find((menu) => menu.id === activePage);
  const pageTitle = activeMenu ? activeMenu.label : "Kasir";

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
          {activePage === "cashier" ? <CashierPage /> : null}
          {activePage === "products" ? <ProductsPage /> : null}
          {activePage === "inventory" ? <InventoryPage /> : null}
          {activePage === "transactions" ? <TransactionsPage /> : null}
          {activePage === "reports" ? <ReportsPage /> : null}
          {activePage === "settings" ? <SettingsPage /> : null}
        </section>
      </main>
    </div>
  );
}

function CashierPage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Semua");
  const [cart, setCart] = useState([]);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState("");

  const activeProducts = useMemo(() => {
    return dummyProducts
      .filter((product) => product.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

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

  const cartTotal = useMemo(() => {
    return cart.reduce((total, item) => total + item.price * item.qty, 0);
  }, [cart]);

  const numericCashReceived = Number(cashReceived || 0);
  const changeAmount = numericCashReceived - cartTotal;
  const isPaymentValid = cart.length > 0 && numericCashReceived >= cartTotal;

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
  }

  function openPaymentModal() {
  if (cart.length === 0) return;

  setCashReceived(String(cartTotal));
  setIsPaymentOpen(true);
}

function closePaymentModal() {
  setIsPaymentOpen(false);
  setCashReceived("");
}

function finishTransaction() {
  if (!isPaymentValid) return;

  alert(
    `Transaksi berhasil!\nTotal: ${formatRupiah(cartTotal)}\nBayar: ${formatRupiah(
      numericCashReceived
    )}\nKembalian: ${formatRupiah(changeAmount)}`
  );

  setCart([]);
  setCashReceived("");
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
          <span>Total</span>
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
            <div>
              <span>Total Belanja</span>
              <strong>{formatRupiah(cartTotal)}</strong>
            </div>

            <button
              type="button"
              className="pay-button"
              disabled={cart.length === 0}
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

function TransactionsPage() {
  return (
    <div className="empty-page">
      <h3>Riwayat</h3>
      <p>Semua transaksi, detail transaksi, dan cetak ulang struk.</p>
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