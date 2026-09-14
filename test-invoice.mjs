
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://db.adzfohfdindovfcpaizb.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '...'; // I will just simulate what the API does


