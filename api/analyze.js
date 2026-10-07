// Vercel serverless function: geocode (optional) + ERA5 climate drivers + bloom-risk index
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const get=async(u,h={})=>{const r=await fetch(u,{headers:{'User-Agent':'Limnoscope/1.0 (github)',...h}});if(!r.ok)throw new Error('upstream '+r.status);return r.json()};
export default async function handler(req,res){
  try{
    let {name='',lat,lon,start,end}=req.query;
    const today=Date.now();
    if(!end)end=new Date(today-6*864e5).toISOString().slice(0,10);
    if(!start)start=new Date(new Date(end)-365*864e5).toISOString().slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||new Date(end)<=new Date(start))return res.status(400).json({error:'bad_dates'});
    if((new Date(end)-new Date(start))/864e5>366*10)return res.status(400).json({error:'range_too_long'});
    let place=name;
    if(lat===undefined||lon===undefined||lat===''||lon===''){
      if(!name)return res.status(400).json({error:'need_input'});
      let hit=null;
      try{const g=await get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1&accept-language=en`);if(g[0])hit={lat:+g[0].lat,lon:+g[0].lon,n:g[0].display_name}}catch(e){}
      if(!hit){const g=await get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`);if(g.results)hit={lat:g.results[0].latitude,lon:g.results[0].longitude,n:g.results[0].name+', '+(g.results[0].country||'')}}
      if(!hit)return res.status(404).json({error:'not_found'});
      lat=hit.lat;lon=hit.lon;place=hit.n;
    }
    lat=+lat;lon=+lon;
    if(!(Math.abs(lat)<=90&&Math.abs(lon)<=180))return res.status(400).json({error:'bad_coords'});
    const u=`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${start}&end_date=${end}&daily=temperature_2m_mean,precipitation_sum,wind_speed_10m_max,shortwave_radiation_sum&timezone=auto`;
    const d=(await get(u)).daily;
    const n=d.time.length,risk=[];
    for(let i=0;i<n;i++){
      const T=clamp((d.temperature_2m_mean[i]-15)/13);
      const W=clamp(1-((d.wind_speed_10m_max[i]/3.6)-2)/4);      // calm water favours cyanobacteria
      const R=clamp(d.shortwave_radiation_sum[i]/22);
      let p=0;for(let k=Math.max(0,i-13);k<=i;k++)p+=d.precipitation_sum[k]||0;
      const P=clamp(p/80);                                        // 14-day rain = nutrient pulse proxy
      risk.push(+(100*(.4*T+.25*W+.2*R+.15*P)).toFixed(1));
    }
    res.setHeader('Cache-Control','s-maxage=86400, stale-while-revalidate');
    res.status(200).json({place,lat,lon,start,end,source:'Open-Meteo / ERA5',daily:{time:d.time,temp:d.temperature_2m_mean,precip:d.precipitation_sum,wind:d.wind_speed_10m_max,rad:d.shortwave_radiation_sum,risk}});
  }catch(e){res.status(502).json({error:'upstream_failed',detail:String(e.message||e)})}
}
