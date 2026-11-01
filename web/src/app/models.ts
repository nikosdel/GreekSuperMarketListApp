export interface ShoppingList {
  id: number;
  title: string;
  status: 'open' | 'saved';
  invite_code: string | null;
  role?: 'owner' | 'editor';
  created_at: string;
  saved_at: string | null;
  saved_by_name: string | null;
}

export interface ListItem {
  id: number;
  product_id: number | null;
  quantity: string;
  product_name: string;
  chain_name: string;
  price_at_save: number | null;
  unit_price_at_save: number | null;
  current_price: number | null;
  unit_price_text: string | null;
}

export interface Member {
  id: number;
  display_name: string;
  role: 'owner' | 'editor';
}

export interface ListDetail extends ShoppingList {
  members: Member[];
  items: ListItem[];
}

export interface CatalogProduct {
  id: number;
  name: string;
  chain_name: string;
  price: number | null;
  unit_price_text: string | null;
  observed_at: string | null;
}

export interface Notice {
  id: number;
  list_id: number;
  kind: string;
  message: string;
  created_at: string;
  read_at: string | null;
}
