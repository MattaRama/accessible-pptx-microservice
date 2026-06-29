import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { type Database } from "../supabase/database.types";

config();

export const supabase = createClient<Database>(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_KEY']!
)