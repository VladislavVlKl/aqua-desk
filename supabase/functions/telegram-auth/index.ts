import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function verifyTelegramInitData(initData: string, botToken: string): Promise<number | null> {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    const encoder = new TextEncoder()

    const webAppDataKey = await crypto.subtle.importKey(
      'raw', encoder.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const secretKeyBytes = await crypto.subtle.sign('HMAC', webAppDataKey, encoder.encode(botToken))

    const hmacKey = await crypto.subtle.importKey(
      'raw', secretKeyBytes,
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const signatureBytes = await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(dataCheckString))

    const computedHash = Array.from(new Uint8Array(signatureBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    if (computedHash !== hash) return null

    const userStr = params.get('user')
    if (!userStr) return null
    const user = JSON.parse(userStr)
    return user.id
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { initData } = await req.json()

    const botToken = Deno.env.get('BOT_TOKEN')
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'BOT_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const tgId = await verifyTelegramInitData(initData, botToken)
    if (!tgId) {
      return new Response(JSON.stringify({ error: 'Invalid Telegram data' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
    const anonClient = createClient(supabaseUrl, anonKey)

    const email = `tg_${tgId}@aquadesk.internal`

    // Детерминированный пароль: SHA-256(tgId:botToken)
    const pwBytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${tgId}:${botToken}`)
    )
    const password = Array.from(new Uint8Array(pwBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // Пробуем войти
    let { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({ email, password })

    if (signInError) {
      // Пользователя нет — создаём
      const { error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { tg_id: tgId }
      })

      if (createError && !createError.message.includes('already registered')) {
        throw createError
      }

      const retry = await anonClient.auth.signInWithPassword({ email, password })
      if (retry.error) throw retry.error
      signInData = retry.data
    }

    return new Response(JSON.stringify({ session: signInData!.session, tg_id: tgId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
