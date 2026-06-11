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
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function replaceProductsInSupabase(products) {
  const { error: deleteError } = await supabase.from("products").delete().neq("id", 0);

  if (deleteError) {
    throw deleteError;
  }

  const rows = products.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category,
    price: product.price,
    cost: product.cost,
    unit: product.unit,
    active: product.active,
  }));

  const { error } = await supabase.from("products").insert(rows);

  if (error) {
    throw error;
  }
}

export async function replaceProductVariantsInSupabase(productVariants) {
  const { error: deleteError } = await supabase
    .from("product_variants")
    .delete()
    .neq("id", 0);

  if (deleteError) {
    throw deleteError;
  }

  const rows = productVariants.map((variant) => ({
    id: variant.id,
    product_id: variant.productId,
    name: variant.name,
    qty_multiplier: variant.qtyMultiplier,
    price: variant.price,
    active: variant.active,
  }));

  const { error } = await supabase.from("product_variants").insert(rows);

  if (error) {
    throw error;
  }
}

export async function replaceStockBatchesInSupabase(stockBatches) {
  const { error: deleteError } = await supabase
    .from("stock_batches")
    .delete()
    .neq("id", 0);

  if (deleteError) {
    throw deleteError;
  }

  const rows = stockBatches.map((batch) => ({
    id: batch.id,
    product_id: batch.productId,
    batch_code: batch.batchCode,
    purchase_date: batch.purchaseDate,
    qty_initial: batch.qtyInitial,
    qty_remaining: batch.qtyRemaining,
    cost: batch.cost,
  }));

  const { error } = await supabase.from("stock_batches").insert(rows);

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