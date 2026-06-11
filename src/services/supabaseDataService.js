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