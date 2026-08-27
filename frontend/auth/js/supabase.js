const SUPABASE_URL = "https://khbunbecvjhnxfhvtpws.supabase.co";

const SUPABASE_ANON_KEY =
    "sb_publishable_cprQjyzEeAShAn6R27sXMQ_P_dWlmEY";

const API_BASE =
    (window.CapacityConnectConfig && window.CapacityConnectConfig.API_BASE_URL) ||
    "https://capacity-connect-three.vercel.app/api/v1";
window.API_BASE = API_BASE;
window.CAPACITY_CONNECT_API_URL = API_BASE;

const supabaseClient = window.supabase ? window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
) : null;

console.log("Supabase client initialized for Capacity Connect");