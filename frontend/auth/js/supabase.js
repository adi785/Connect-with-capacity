const SUPABASE_URL = "https://khbunbecvjhnxfhvtpws.supabase.co";

const SUPABASE_ANON_KEY =
    "sb_publishable_cprQjyzEeAShAn6R27sXMQ_P_dWlmEY";

const API_BASE = "http://127.0.0.1:8001/api/v1";
window.API_BASE = API_BASE;

const supabaseClient = window.supabase ? window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
) : null;

console.log("Supabase client initialized for Capacity Connect");