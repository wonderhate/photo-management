import {t,getLocale} from './i18n';
import {useEffect,useState} from 'react';
import {Monitor,Smartphone,RefreshCw,Trash2} from 'lucide-react';
import {api,message} from './api';
import {isRemote,clearIndex} from './remote-client';
type Access={enabled:boolean;pairing_code:string;pairing_expires:number;addresses:string[];public_addresses:string[];devices:number};
export default function RemoteSettings({notify}:{notify:(text:string)=>void}){
  const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [draft,setDraft]=useState('');
  useEffect(()=>{if(!isRemote)api<Access>('/remote/settings').then(setAccess).catch(e=>setError(message(e)))},[]);
  async function change(enabled:boolean){setBusy(true);try{setAccess(await api<Access>('/remote/settings','PUT',{enabled}));setError('');notify(enabled?t("已生成新配对码，旧设备需重新配对"):t("手机访问已关闭"))}catch(e){setError(message(e))}finally{setBusy(false)}}
  async function addPublicAddress(){if(!draft.trim())return;setBusy(true);try{setAccess(await api<Access>('/remote/public-addresses','POST',{address:draft.trim()}));setDraft('');setError('');notify(t("公网地址已登记，请用手机打开该地址确认可访问"))}catch(e){setError(message(e))}finally{setBusy(false)}}
  async function removePublicAddress(address:string){setBusy(true);try{setAccess(await api<Access>('/remote/public-addresses?address='+encodeURIComponent(address),'DELETE'));setError('')}catch(e){setError(message(e))}finally{setBusy(false)}}
  return <section className="settings-card remote-settings">
    <header><Smartphone size={22}/><div><h3>{isRemote?t("我的电脑"):t("手机远程访问")}</h3><p>{isRemote?t("整理、分析和水印草稿保存在电脑。"):t("让手机接续使用这个照片库。")}</p></div></header>
    {isRemote?<>
      <div className="remote-computer"><Monitor size={28}/><div><b>{t("电脑照片库")}</b><small>{location.origin}</small></div><span>{t("已配对")}</span></div>
      <p className="muted">{t("手机只缓存照片索引；图片与水印预览不保存到手机。正式导出后，作品保存至手机相册的 PhotoCollection。")}</p>
      <div className="button-row"><button onClick={()=>{clearIndex(localStorage);notify(t("手机索引已清除"))}}>{t("清除手机索引")}</button><button onClick={()=>window.dispatchEvent(new Event('photo-disconnect'))}>{t("切换电脑 / 重新配对")}</button></div>
    </>:<>
      {access&&<>
        <div className="button-row"><button className={access.enabled?'':'primary'} disabled={busy} onClick={()=>change(!access.enabled)}>{access.enabled?t("关闭手机访问"):t("开启手机访问")}</button>{access.enabled&&<button disabled={busy} onClick={()=>change(true)}><RefreshCw size={15}/>{t("生成新配对码 / 撤销旧设备")}</button>}</div>
        <div className="pairing-details">
          <p>{t('在手机连接页面填写以下两项')}</p>
          <div className="pairing-addresses">
            <span>{t('电脑地址')}</span>
            {access.addresses?.length?access.addresses.map((address,index)=><input key={address} aria-label={access.addresses.length>1?t('电脑地址 {0}',{0:index+1}):t('电脑地址')} readOnly value={address} onFocus={event=>event.currentTarget.select()}/>):<p className="muted">{t("未找到局域网地址，请使用电脑的私有网络 IP。")}</p>}
            <small className="muted">{t('填写完整地址（含 http:// 和端口）；多个地址时，选择手机能访问的局域网或私有 VPN 地址。')}</small>
          </div>
          <label>{t('八位配对码')}<input className="pairing-code" readOnly value={access.enabled?access.pairing_code:''} placeholder={t('开启手机访问后显示')} onFocus={event=>event.currentTarget.select()}/></label>
          <div className="pairing-addresses">
            <span>{t('公网地址（可选）')}</span>
            {access.public_addresses?.map((address,index)=><div className="address-row" key={address}><input aria-label={access.public_addresses.length>1?t('公网地址 {0}',{0:index+1}):t('公网地址')} readOnly value={address} onFocus={event=>event.currentTarget.select()}/><button disabled={busy} aria-label={t('删除公网地址')} onClick={()=>removePublicAddress(address)}><Trash2 size={14}/></button></div>)}
            <div className="address-row"><input type="url" placeholder="https://photos.example.com" aria-label={t('添加公网地址')} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')addPublicAddress()}}/><button disabled={busy} onClick={addPublicAddress}>{t('添加')}</button></div>
            <small className="muted">{t('支持 Tailscale Funnel、Cloudflare Tunnel、frp、端口转发 + 反向代理等自备通道；必须为 https，且指向本机服务。应用不会自动探测公网地址。')}</small>
          </div>
          {access.enabled&&<p>{t("配对码有效至 ")}{new Date(access.pairing_expires*1000).toLocaleTimeString(getLocale())}{t(" · 已配对 ")}{access.devices}{t(" 台")}</p>}
          <p className="muted">{t("手机和电脑连接同一 Wi-Fi，或使用私有 VPN / 已登记的公网 HTTPS 地址。电脑需要保持运行。若 Windows 防火墙提示，请允许专用网络访问。")}</p>
        </div>
      </>}
      {error&&<p className="error-box">{error}</p>}
    </>}
  </section>;
}
