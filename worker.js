// مركز المعطيات الموحّد — Cloudflare Worker + Workers KV
// البرامج الستة ترفع وتحمّل معطياتها من هنا، والبوابة تعرض وتدير النسخ.

const ALLOWED_KEYS = ['consommation', 'invantaire', 'economa', 'soumission', 'paie', 'rapport'];
const APP_NAMES = {
  consommation: 'برنامج التغذية',
  invantaire: 'نظام الجرد',
  economa: 'المحاسب',
  soumission: 'برنامج الاستشارة',
  paie: 'الرواتب والتقاعد',
  rapport: 'التقرير اليومي',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Token',
  'Access-Control-Max-Age': '86400',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // قائمة البرامج وحالة النسخ
    if (url.pathname === '/api/apps' && request.method === 'GET') {
      const apps = [];
      for (const key of ALLOWED_KEYS) {
        const metaRaw = await env.DATA.get('meta:' + key);
        const hasData = (await env.DATA.get('data:' + key)) !== null;
        const meta = metaRaw ? JSON.parse(metaRaw) : null;
        apps.push({
          key,
          name: APP_NAMES[key],
          hasData,
          updatedAt: meta ? meta.updatedAt : null,
          size: meta ? meta.size : 0,
          by: meta ? meta.by : null,
        });
      }
      return json({ ok: true, apps });
    }

    const match = url.pathname.match(/^\/api\/data\/([a-z]+)$/);
    if (!match) return json({ ok: false, error: 'مسار غير معروف' }, 404);
    const key = match[1];
    if (!ALLOWED_KEYS.includes(key)) return json({ ok: false, error: 'مفتاح برنامج غير مسموح' }, 400);

    // تحميل المعطيات (مفتوح دون توكن)
    if (request.method === 'GET') {
      const metaRaw = await env.DATA.get('meta:' + key);
      const data = await env.DATA.get('data:' + key);
      if (data === null) return json({ ok: false, error: 'لا توجد نسخة معطيات لهذا البرنامج بعد' }, 404);
      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      return new Response(data, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Hub-UpdatedAt': meta.updatedAt || '',
          'X-Hub-By': encodeURIComponent(meta.by || ''),
          ...CORS,
        },
      });
    }

    // الرفع والحذف يتطلبان التوكن
    const token = request.headers.get('X-Hub-Token') || url.searchParams.get('token') || '';
    if (!env.HUB_TOKEN || token !== env.HUB_TOKEN) {
      return json({ ok: false, error: 'توكن غير صحيح أو مفقود' }, 401);
    }

    if (request.method === 'PUT') {
      let body;
      try {
        body = await request.text();
        JSON.parse(body);
      } catch (e) {
        return json({ ok: false, error: 'الجسم ليس JSON صالحًا' }, 400);
      }
      if (body.length > 24 * 1024 * 1024) {
        return json({ ok: false, error: 'النسخة أكبر من الحد المسموح (24MB)' }, 413);
      }
      const by = url.searchParams.get('by') || '';
      const updatedAt = new Date().toISOString();
      await env.DATA.put('data:' + key, body);
      await env.DATA.put('meta:' + key, JSON.stringify({ updatedAt, size: body.length, by }));
      return json({ ok: true, key, updatedAt, size: body.length });
    }

    if (request.method === 'DELETE') {
      await env.DATA.delete('data:' + key);
      await env.DATA.delete('meta:' + key);
      return json({ ok: true, key, deleted: true });
    }

    return json({ ok: false, error: 'طريقة غير مدعومة' }, 405);
  },
};
