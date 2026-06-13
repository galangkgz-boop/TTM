import { supabase } from "../lib/supabaseClient";

export async function fetchProductsFromSupabase() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function createProductInSupabase(product) {
  const row = {
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    cost: product.cost,
    unit: product.unit,
    active: product.active,
  };

  const { error } = await supabase.from("products").insert(row);

  if (error) {
    throw error;
  }
}

export async function updateProductInSupabase(product) {
  const row = {
    name: product.name,
    category: product.category,
    price: product.price,
    cost: product.cost,
    unit: product.unit,
    active: product.active,
  };

  const { error } = await supabase
    .from("products")
    .update(row)
    .eq("id", product.id);

  if (error) {
    throw error;
  }
}

export async function createProductVariantInSupabase(variant) {
  const row = {
    id: variant.id,
    product_id: variant.productId,
    name: variant.name,
    qty_multiplier: variant.qtyMultiplier,
    price: variant.price,
    active: variant.active,
  };

  const { error } = await supabase.from("product_variants").insert(row);

  if (error) {
    throw error;
  }
}

export async function updateProductVariantInSupabase(variant) {
  const row = {
    product_id: variant.productId,
    name: variant.name,
    qty_multiplier: variant.qtyMultiplier,
    price: variant.price,
    active: variant.active,
  };

  const { error } = await supabase
    .from("product_variants")
    .update(row)
    .eq("id", variant.id);

  if (error) {
    throw error;
  }
}

export async function fetchProductVariantsFromSupabase() {
  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function fetchStockBatchesFromSupabase() {
  const { data, error } = await supabase
    .from("stock_batches")
    .select("*")
    .order("purchase_date", { ascending: true });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function fetchStoreSettingsFromSupabase() {
  const { data, error } = await supabase
    .from("store_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

export async function createStockBatchInSupabase(batch) {
  const row = {
    id: batch.id,
    product_id: batch.productId,
    batch_code: batch.batchCode,
    purchase_date: batch.purchaseDate,
    qty_initial: batch.qtyInitial,
    qty_remaining: batch.qtyRemaining,
    cost: batch.cost,
  };

  const { error } = await supabase.from("stock_batches").insert(row);

  if (error) {
    throw error;
  }
}

export async function updateStoreSettingsInSupabase(settings) {
  const row = {
    id: 1,
    store_name: settings.storeName,
    address: settings.address,
    phone: settings.phone,
    receipt_note: settings.receiptNote,
    low_stock_threshold: settings.lowStockThreshold,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("store_settings").upsert(row);

  if (error) {
    throw error;
  }
}

export async function createTransactionInSupabase(transaction) {
  const { data: existingTransaction, error: existingError } = await supabase
    .from("transactions")
    .select("id")
    .eq("code", transaction.code)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingTransaction) {
    return existingTransaction;
  }

  const transactionRow = {
  code: transaction.code,
  transaction_date: transaction.date,
  subtotal: transaction.subtotal,
  discount: transaction.discount,
  total: transaction.total,
  cash_received: transaction.cashReceived,
  change_amount: transaction.change,
  payment_method: transaction.paymentMethod,
  profit: transaction.profit,
  cashier_name: transaction.cashierName || "",
  cashier_role: transaction.cashierRole || "",
};

  const { data: createdTransaction, error: transactionError } = await supabase
    .from("transactions")
    .insert(transactionRow)
    .select()
    .single();

  if (transactionError) {
    throw transactionError;
  }

  const transactionItems = transaction.items.map((item) => ({
    transaction_id: createdTransaction.id,
    product_id: item.productId || item.id || null,
    variant_id: item.variantId || null,
    name: item.name,
    product_name: item.productName || item.name,
    variant_name: item.variantName || null,
    category: item.category || "",
    unit: item.unit || "pcs",
    qty: item.qty,
    qty_multiplier: item.qtyMultiplier || 1,
    fifo_qty: item.fifoQty || item.qty,
    price: item.price,
    subtotal: item.subtotal,
    total_cost: item.totalCost || 0,
    profit: item.profit || 0,
  }));

  const { data: createdItems, error: itemsError } = await supabase
    .from("transaction_items")
    .insert(transactionItems)
    .select();

  if (itemsError) {
    throw itemsError;
  }

  const itemBatchRows = [];

  transaction.items.forEach((item, itemIndex) => {
    const createdItem = createdItems[itemIndex];

    if (!createdItem || !Array.isArray(item.fifoBatches)) {
      return;
    }

    item.fifoBatches.forEach((batch) => {
      itemBatchRows.push({
        transaction_item_id: createdItem.id,
        stock_batch_id: batch.batchId || null,
        batch_code: batch.batchCode,
        purchase_date: batch.purchaseDate,
        qty: batch.qty,
        cost: batch.cost,
        total_cost: batch.totalCost,
      });
    });
  });

  if (itemBatchRows.length > 0) {
    const { error: batchesError } = await supabase
      .from("transaction_item_batches")
      .insert(itemBatchRows);

    if (batchesError) {
      throw batchesError;
    }
  }

  return createdTransaction;
}

export async function updateStockBatchesInSupabase(stockBatches) {
  const updates = stockBatches.map((batch) =>
    supabase
      .from("stock_batches")
      .update({
        qty_initial: batch.qtyInitial,
        qty_remaining: batch.qtyRemaining,
        cost: batch.cost,
      })
      .eq("id", batch.id)
  );

  const results = await Promise.all(updates);

  const failedResult = results.find((result) => result.error);

  if (failedResult) {
    throw failedResult.error;
  }
}

export async function updateUsedStockBatchesInSupabase(transaction, stockBatches) {
  const usedBatchIds = new Set();

  transaction.items.forEach((item) => {
    if (!Array.isArray(item.fifoBatches)) {
      return;
    }

    item.fifoBatches.forEach((batch) => {
      if (batch.batchId) {
        usedBatchIds.add(batch.batchId);
      }
    });
  });

  const usedBatches = stockBatches.filter((batch) => usedBatchIds.has(batch.id));

  if (usedBatches.length === 0) {
    return;
  }

  const updates = usedBatches.map((batch) =>
    supabase
      .from("stock_batches")
      .update({
        qty_initial: batch.qtyInitial,
        qty_remaining: batch.qtyRemaining,
        cost: batch.cost,
      })
      .eq("id", batch.id)
  );

  const results = await Promise.all(updates);

  const failedResult = results.find((result) => result.error);

  if (failedResult) {
    throw failedResult.error;
  }
}

export async function fetchTransactionsFromSupabase() {
  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      *,
      transaction_items (
        *,
        transaction_item_batches (*)
      )
    `
    )
    .order("transaction_date", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

export async function fetchCurrentProfileFromSupabase(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function saveCashierSessionToSupabase(session) {
  const row = {
    id: session.id,
    opened_at: session.openedAt,
    closed_at: session.closedAt || null,
    opening_cash: Number(session.openingCash || 0),
    actual_closing_cash:
      session.actualClosingCash === undefined ? null : Number(session.actualClosingCash || 0),
    estimated_closing_cash:
      session.estimatedClosingCash === undefined ? null : Number(session.estimatedClosingCash || 0),
    closing_cash_difference:
      session.closingCashDifference === undefined ? null : Number(session.closingCashDifference || 0),
    closing_cash_status: session.closingCashStatus || null,
    is_open: session.isOpen === true,
  };

  const { error } = await supabase.from("cashier_sessions").upsert(row);

  if (error) {
    throw error;
  }
}

export async function createCashFlowInSupabase(cashFlow) {
  const row = {
    id: cashFlow.id,
    cashier_session_id: cashFlow.cashierSessionId || null,
    type: cashFlow.type,
    note: cashFlow.note,
    amount: Number(cashFlow.amount || 0),
    created_at: cashFlow.createdAt,
  };

  const { error } = await supabase.from("cash_flows").upsert(row);

  if (error) {
    throw error;
  }
}

export async function createCashierClosingInSupabase(closing) {
  const row = {
    id: closing.id,
    cashier_session_id: closing.cashierSessionId || null,
    opened_at: closing.openedAt || null,
    closed_at: closing.closedAt,
    opening_cash: Number(closing.openingCash || 0),
    sales_total: Number(closing.salesTotal || 0),
    cash_in_total: Number(closing.cashInTotal || 0),
    cash_out_total: Number(closing.cashOutTotal || 0),
    discount_total: Number(closing.discountTotal || 0),
    profit_total: Number(closing.profitTotal || 0),
    transaction_count: Number(closing.transactionCount || 0),
    estimated_closing_cash: Number(closing.estimatedClosingCash || 0),
    actual_closing_cash: Number(closing.actualClosingCash || 0),
    difference: Number(closing.difference || 0),
    status: closing.status || "Belum dicek",
  };

  const { error } = await supabase.from("cashier_closings").upsert(row);

  if (error) {
    throw error;
  }
}

export async function fetchCashierClosingsFromSupabase() {
  const { data, error } = await supabase
    .from("cashier_closings")
    .select("*")
    .order("closed_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}