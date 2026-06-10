import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { dummyProducts } from "./db/dummyProducts";
import { dummyStockBatches } from "./db/dummyStockBatches";
import { dummyProductVariants } from "./db/dummyProductVariants";
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
const PRODUCTS_STORAGE_KEY = "ttm_pos_products";
const PRODUCT_VARIANTS_STORAGE_KEY = "ttm_pos_product_variants";

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

function App() {
  const [activePage, setActivePage] = useState("cashier");

  const [products, setProducts] = useState(() => {
  const savedProducts = localStorage.getItem(PRODUCTS_STORAGE_KEY);

  if (!savedProducts) {
    return dummyProducts;
  }

  try {
    return JSON.parse(savedProducts);
  } catch {
    return dummyProducts;
  }
});

const [productVariants, setProductVariants] = useState(() => {
  const savedVariants = localStorage.getItem(PRODUCT_VARIANTS_STORAGE_KEY);

  if (!savedVariants) {
    return dummyProductVariants;
  }

  try {
    return JSON.parse(savedVariants);
  } catch {
    return dummyProductVariants;
  }
});

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

  function addTransaction(transaction, updatedBatches) {
  setTransactions((currentTransactions) => [
    transaction,
    ...currentTransactions,
  ]);

  if (updatedBatches) {
    setStockBatches(updatedBatches);
  }
}

  function addStockBatch(newBatch) {
    setStockBatches((currentBatches) => [
      ...currentBatches, 
      newBatch,
    ]);
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

function addProduct(newProduct) {
  setProducts((currentProducts) => [
    ...currentProducts,
    newProduct,
  ]);
}

function updateProduct(updatedProduct) {
  setProducts((currentProducts) =>
    currentProducts.map((product) =>
      product.id === updatedProduct.id ? updatedProduct : product
    )
  );
}

function deactivateProduct(productId) {
  const confirmDeactivate = window.confirm(
    "Nonaktifkan produk ini? Produk tidak akan muncul di kasir."
  );

  if (confirmDeactivate === false) {
    return;
  }

  setProducts((currentProducts) =>
    currentProducts.map((product) =>
      product.id === productId
        ? {
            ...product,
            active: false,
          }
        : product
    )
  );
}

function activateProduct(productId) {
  setProducts((currentProducts) =>
    currentProducts.map((product) =>
      product.id === productId
        ? {
            ...product,
            active: true,
          }
        : product
    )
  );
}

function addProductVariant(newVariant) {
  setProductVariants((currentVariants) => [
    ...currentVariants,
    newVariant,
  ]);
}

function updateProductVariant(updatedVariant) {
  setProductVariants((currentVariants) =>
    currentVariants.map((variant) =>
      variant.id === updatedVariant.id ? updatedVariant : variant
    )
  );
}

function deactivateProductVariant(variantId) {
  const confirmDeactivate = window.confirm(
    "Nonaktifkan varian ini? Varian tidak akan muncul di kasir."
  );

  if (confirmDeactivate === false) {
    return;
  }

  setProductVariants((currentVariants) =>
    currentVariants.map((variant) =>
      variant.id === variantId
        ? {
            ...variant,
            active: false,
          }
        : variant
    )
  );
}

function activateProductVariant(variantId) {
  setProductVariants((currentVariants) =>
    currentVariants.map((variant) =>
      variant.id === variantId
        ? {
            ...variant,
            active: true,
          }
        : variant
    )
  );
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
            productVariants={productVariants}
            stockBatches={stockBatches}
            transactions={transactions}
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
            onClearTransactions={clearTransactions} 
            /> 
          ) : null}

          {activePage === "reports" ? (
  <ReportsPage transactions={transactions} />
) : null}
          {activePage === "settings" ? <SettingsPage /> : null}
        </section>
      </main>
    </div>
  );
}

function CashierPage({ products, productVariants, stockBatches, transactions, onAddTransaction }) {
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

  return result;
}, [productVariants]);

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
            {filteredProducts.map((product) => {
  const productVariantsForCashier = activeVariantsByProductId[product.id] || [];

  return (
    <div key={product.id} className="product-card">
      <button
  type="button"
  className="product-main-button"
  disabled={Number(product.stock || 0) <= 0}
  onClick={() => addToCart(product, null)}
>
        <div>
          <h4>{product.name}</h4>
          <p>{product.category}</p>
        </div>

        <div className="product-card-footer">
          <strong>{formatRupiah(product.price)}</strong>
<span>
  {Number(product.stock || 0) <= 0 ? "Stok habis" : "Stok " + product.stock}
</span>
        </div>
      </button>

      {productVariantsForCashier.length > 0 ? (
        <div className="cashier-variant-list">
          {productVariantsForCashier.map((variant) => {
  const variantStockNeeded = Number(variant.qtyMultiplier || 1);
  const isVariantOutOfStock = Number(product.stock || 0) < variantStockNeeded;

  return (
    <button
      key={variant.id}
      type="button"
      className="cashier-variant-button"
      disabled={isVariantOutOfStock}
      onClick={() => addToCart(product, variant)}
    >
      <span>
        {variant.name}
        {variantStockNeeded > 1 ? " • isi " + variantStockNeeded : ""}
      </span>

      <strong>
        {isVariantOutOfStock ? "Stok kurang" : formatRupiah(variant.price)}
      </strong>
    </button>
  );
})}
        </div>
      ) : null}
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
              <div key={item.cartItemId} className="cart-item">
                <div>
                  <h5>{item.name}</h5>
                  <p>
  {formatRupiah(item.price)} / {item.unit}
  {Number(item.qtyMultiplier || 1) > 1
    ? " • FIFO " + item.qtyMultiplier + " " + item.unit
    : ""}
</p>
                </div>

                <div className="qty-control">
                  <button type="button" onClick={() => decreaseQty(item.cartItemId)}>
                    -
                  </button>
                  <span>{item.qty}</span>
                  <button type="button" onClick={() => increaseQty(item.cartItemId)}>
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

  const sortedProducts = [...products].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

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

        <button
          type="button"
          className="primary-action-button"
          onClick={openAddProductForm}
        >
          Tambah Produk
        </button>
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
            {sortedProducts.map((product) => {
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

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        totalStock: totalStock,
        totalStockValue: totalStockValue,
        batchCount: productBatches.length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

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
      const productCompare = a.productName.localeCompare(b.productName);

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

function closeBatchForm() {
  setIsBatchFormOpen(false);
  resetBatchForm();
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

  return (
    <div>
      <div className="inventory-header">
        <div>
          <h3>Stok FIFO</h3>
          <p className="muted">
            Semua stok produk dihitung dari batch FIFO yang masih memiliki qty sisa.
          </p>
        </div>

        <button
          type="button"
          className="primary-action-button"
          onClick={() => setIsBatchFormOpen(true)}
        >
          Tambah Batch
        </button>
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

        {filteredTransactions.length > 0 ? (
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

        {filteredTransactions.length === 0 ? (
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

        <div className="detail-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportsPage({ transactions }) {
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

function SettingsPage() {
  return (
    <div className="empty-page">
      <h3>Pengaturan</h3>
      <p>Nama toko, alamat, nomor WhatsApp, catatan struk, dan pengaturan kasir.</p>
    </div>
  );
}

export default App;