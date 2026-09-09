/* ============================================================
   board.js — base compartida del super tablero Real de Miramar
   TODO sale del Google Sheet vía Apps Script (?recurso=board).
   Nada de datos hardcodeados aquí: solo estructura y selectores.
   Cada página define window.renderPage(B) y llama Board.init().
   Accesos: publico-lite (sin clave, sin precios) · clave de vista
   (detalle) · clave financiera (cuentas/dirección, valida el GAS).
   ============================================================ */
(function(){
"use strict";

var CONFIG={
  SHEET_URL:"https://script.google.com/macros/s/AKfycbzR0-hoPMs7N_1nSD0pFbJtTmaN4kLCIbNFsYw7VeM3xnfu12TSKJSkMyNxm7KNn7o/exec",
  VIEW_KEY:"Yodesarrollo1" /* clave de VISTA (seguridad suave). Las claves financiera/escritura JAMÁS van aquí: las valida el servidor. */
};
var CACHE_KEY="rm_cache_v3", UNLOCK_KEY="rm_unlock_v1", FIN_KEY="rm_fin_v1";
var TTL=90000, FETCH_TIMEOUT=15000;
var DATA=null, PAGE="", OPTS={}, FIN=null;

/* ---------- utilidades ---------- */
function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function money(n){n=Number(String(n).replace(/[^0-9.\-]/g,""));if(isNaN(n)||n===0)return"—";return"$"+Math.round(n).toLocaleString("es-MX");}
function clase(e){var s=String(e||"").toLowerCase();if(s.indexOf("verde")>=0)return"verde";if(s.indexOf("amar")>=0)return"amar";if(s.indexOf("rojo")>=0)return"rojo";return"gris";}
function toast(m,w){var t=$("toast");if(!t)return;t.textContent=m;t.className="on"+(w?" warn":"");setTimeout(function(){t.className="";},2800);}
function fmtFecha(f){if(!f)return"";var d=new Date(String(f)+"T12:00:00");if(isNaN(d))return String(f);return d.toLocaleDateString("es-MX",{day:"numeric",month:"short",year:"numeric"});}

/* ---------- acceso ---------- */
function unlocked(){try{if(sessionStorage.getItem("RM_PORTERO")==="ok")return true;return localStorage.getItem(UNLOCK_KEY)===CONFIG.VIEW_KEY;}catch(e){return false;}}
/* El Portero (potenciales-yod) es la autoridad de ligas mágicas: si hay un token de
   sesión compartido, se valida contra su /exec y abre la vista sin pedir clave. */
function porteroIntento(cb){var t=null;try{t=localStorage.getItem("pyod_clave_v1");}catch(e){}
  if(!t||String(t).indexOf("sy")!==0){cb(false);return;}
  try{fetch("https://script.google.com/macros/s/AKfycbwlDDCWWzOWYZsUpBU9uqsQ7aenQ469PF6s6FkNlBFS1_cJSU5njG9oQmuyELy5zlqzFg/exec?recurso=canje&board=RM&t="+encodeURIComponent(t),{credentials:'omit'})
    .then(function(r){return r.json();})
    .then(function(d){if(d&&d.ok){try{sessionStorage.setItem("RM_PORTERO","ok");}catch(e){}cb(true);}else cb(false);})
    .catch(function(){cb(false);});}catch(e){cb(false);}}
function lite(){return !unlocked();}
function finGuardada(){try{return sessionStorage.getItem(FIN_KEY)||"";}catch(e){return"";}}
/* Credencial del Portero (misma llave que portero.js): viaja como k en CADA petición.
   El backend la valida server-to-server; sin ella no entrega ni un dato (fail-closed). */
function credencial(){try{return localStorage.getItem("pyod_clave_v1")||"";}catch(e){return"";}}
var PYOD_EXEC="https://script.google.com/macros/s/AKfycbwlDDCWWzOWYZsUpBU9uqsQ7aenQ469PF6s6FkNlBFS1_cJSU5njG9oQmuyELy5zlqzFg/exec";
function _pyodCerrar(){try{localStorage.removeItem("pyod_clave_v1");localStorage.removeItem(CACHE_KEY);sessionStorage.removeItem("RM_PORTERO");sessionStorage.removeItem("pyod_rol");}catch(e){}location.reload();}
function _pyodAviso(){ if(document.getElementById("pyodAviso"))return; var d=document.createElement("div");d.id="pyodAviso";d.style.cssText="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483000;max-width:min(560px,92vw);background:#221E17;color:#F1EDE3;border:1px solid rgba(255,255,255,.14);border-left:3px solid #B98B3C;border-radius:12px;padding:14px 16px;font-family:'Instrument Sans',system-ui,sans-serif;font-size:13px;line-height:1.5;box-shadow:0 18px 48px rgba(0,0,0,.5)";d.innerHTML='<b style=\"color:#B98B3C\">Tu sesión es válida.</b> Este tablero no validó tu acceso: su backend (Apps Script) necesita re-desplegarse. Tu sesión NO se cerró. <a href=\"https://alexpueblag.github.io/yod-portal/os/\" style=\"color:#B98B3C\">Volver a YOD OS</a> · <button id=\"pyodAvX\" style=\"background:none;border:0;color:#8A8272;cursor:pointer;text-decoration:underline;font:inherit\">Ocultar</button>';document.body.appendChild(d);var x=document.getElementById("pyodAvX");if(x)x.onclick=function(){d.remove();}; }
/* ANTI-LOOP (agosto 2026): dominio suspendido → el backend contesta "liga" a
   la clave del portero de respaldo aunque la sesión sea válida. Antes esto
   borraba la credencial y recargaba = bucle. Ahora solo avisa; la sesión se
   suelta únicamente desde "Salir". El respaldo local (datos.enc, cifrado) cubre el resto. */
function credencialRechazada(){ _pyodAviso(); }

/* ---------- fetch único con caché TTL ---------- */
function leerCache(){try{var c=JSON.parse(localStorage.getItem(CACHE_KEY));if(c&&c.j&&c.j.tablas)return c;}catch(e){}return null;}
function guardarCache(j){try{localStorage.setItem(CACHE_KEY,JSON.stringify({t:Date.now(),j:j}));}catch(e){}}
/* Descifra el respaldo empacado. Mismo esquema que el pintarrón y que el board
   de inversión: openssl -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt -base64.
   La frase NO va escrita aquí: la trae el usuario en su credencial del Portero.
   Si estuviera en este archivo, el cifrado sería decorativo. */
var RESPALDO_SSK = "yod_respaldo_clave";
function _b64aBytes(b64){
  var bin = atob(String(b64).replace(/\s+/g, ""));
  var u = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
function descifrarRespaldo(b64, pass){
  var raw = _b64aBytes(b64);
  if (raw.length < 16 || String.fromCharCode.apply(null, raw.slice(0, 8)) !== "Salted__")
    return Promise.reject(new Error("formato inesperado"));
  var salt = raw.slice(8, 16), cipher = raw.slice(16);
  return crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"])
    .then(function(pk){
      return crypto.subtle.deriveBits({ name:"PBKDF2", salt:salt, iterations:200000, hash:"SHA-256" }, pk, 384);
    }).then(function(bits){
      var b = new Uint8Array(bits);
      return crypto.subtle.importKey("raw", b.slice(0,32), { name:"AES-CBC" }, false, ["decrypt"])
        .then(function(ak){ return crypto.subtle.decrypt({ name:"AES-CBC", iv:b.slice(32,48) }, ak, cipher); });
    }).then(function(plano){ return JSON.parse(new TextDecoder().decode(plano)); });
}
/* Baja datos.enc y lo abre con la primera frase que sirva: la credencial del
   Portero, la ya validada en esta pestaña, o —solo si no hay otra— una que se
   pide una vez. Sin frase válida lanza respaldo_ilegible y NO se pinta nada. */
function cargarRespaldoCifrado(credFn){
  return fetch("datos.enc?cb=" + Date.now(), { cache:"no-store" }).then(function(r){
    if (!r.ok) throw new Error("http_" + r.status);
    return r.text();
  }).then(function(b64){
    b64 = b64.trim();
    var frases = [], k = credFn();
    if (k) frases.push(k);
    try { var g = sessionStorage.getItem(RESPALDO_SSK); if (g && frases.indexOf(g) === -1) frases.push(g); } catch(e){}
    function intenta(i){
      if (i >= frases.length){
        var t = "";
        try { t = (window.prompt("El servidor no responde. Escribe la clave del equipo para abrir el respaldo:") || "").trim(); } catch(e){}
        if (!t) throw new Error("respaldo_ilegible");
        return descifrarRespaldo(b64, t).then(function(j){
          try { sessionStorage.setItem(RESPALDO_SSK, t); } catch(e){}
          return j;
        }).catch(function(){ throw new Error("respaldo_ilegible"); });
      }
      return descifrarRespaldo(b64, frases[i]).then(function(j){
        try { sessionStorage.setItem(RESPALDO_SSK, frases[i]); } catch(e){}
        return j;
      }).catch(function(){ return intenta(i + 1); });
    }
    return intenta(0);
  });
}

function fetchBoard(fin,cb){
  /* Sin credencial del Portero no se pide nada: el gate del Portero (portero.js)
     está cubriendo la pantalla para iniciar sesión. Evita el bucle de recarga. */
  if(!credencial()){setBadge("error","Inicia sesión");if(cb)cb(new Error("sin_credencial"));return;}
  setBadge("loading","Cargando");
  var url=CONFIG.SHEET_URL+"?recurso=board&k="+encodeURIComponent(credencial())+(fin?("&fin="+encodeURIComponent(fin)):"")+"&cb="+Date.now();
  var ctrl=new AbortController();var to=setTimeout(function(){ctrl.abort();},FETCH_TIMEOUT);
  fetch(url,{signal:ctrl.signal,credentials:'omit'}).then(function(r){return r.json();}).then(function(j){
    clearTimeout(to);
    if(j&&j.error==="liga"){credencialRechazada();cb(new Error("liga"));return;}   /* clave que el backend no valida → cae al respaldo */
    if(j&&j.tablas){if(!fin)guardarCache(j);cb(null,j);}
    else cb(new Error("respuesta sin tablas"));
  }).catch(function(e){clearTimeout(to);cb(e);});
}
function cargar(cb){
  if(OPTS.acceso==="fin"){
    var k=finGuardada();
    if(!k){pedirFin(cb);return;}
    fetchBoard(k,function(err,j){
      if(!err&&j.meta&&j.meta.incluye_financiero){FIN=k;DATA=j;setBadge("live","En vivo · interno");cb();}
      else{try{sessionStorage.removeItem(FIN_KEY);}catch(e){}pedirFin(cb);}
    });
    return;
  }
  /* Si hay clave financiera guardada, traemos también el dinero (para
     el hero de Inicio); si no, la vista pública normal. */
  var fk=finGuardada();
  var c=leerCache();
  if(credencial()&&!fk&&c&&(Date.now()-c.t)<TTL){DATA=c.j;setBadge("live","En vivo");cb();return;}   /* caché solo con credencial */
  fetchBoard(fk||null,function(err,j){
    if(!err){if(fk&&j.meta&&j.meta.incluye_financiero)FIN=fk;DATA=j;setBadge("live",FIN?"En vivo · interno":"En vivo");cb();}
    else if(credencial()&&c){DATA=c.j;setBadge("cache","Copia guardada");cb();}   /* caché solo con credencial */
    else{
      /* Respaldo empacado (agosto 2026): foto del Sheet, ahora cifrada, para que
         Miramar nunca aparezca en blanco mientras el dominio esté suspendido.
         Solo lectura; al reactivar Google, el fetch en vivo vuelve a mandar. */
      /* El respaldo va CIFRADO (datos.enc). Antes era datos.json en claro y se
         pintaba a cualquiera que abriera la liga sin credencial: el gate es
         portero.js, que corre en el navegador y no protege el archivo. */
      cargarRespaldoCifrado(credencial).then(function(dj){
        dj = (dj && dj.data) || dj;
        if(dj&&dj.tablas){DATA=dj;setBadge("cache","Respaldo local");cb();}
        else throw new Error("respaldo sin tablas");
      }).catch(function(e){
        var sinLlave = e && e.message === "respaldo_ilegible";
        setBadge("error", sinLlave ? "Inicia sesión" : "Sin datos");
        var a=$("app");
        if(a)a.insertAdjacentHTML("afterbegin",'<div class="gatebanner">'+(sinLlave
          ? 'Necesitas iniciar sesión para ver este tablero.'
          : 'No se pudo cargar el tablero. Revisa la conexión.')+'</div>');
      });
    }
  });
}
function refrescar(){try{localStorage.removeItem(CACHE_KEY);}catch(e){}cargar(function(){if(window.renderPage)window.renderPage(Board);toast("Actualizado");});}

/* ---------- overlays de acceso ---------- */
function pedirClave(cb){
  document.body.insertAdjacentHTML("beforeend",
    '<div id="gate"><div class="box"><div class="serif" style="font-size:22px;">Real de Miramar</div>'+
    '<div class="nota" style="margin-top:4px;">Tablero del proyecto · acceso con clave</div>'+
    '<input id="gKey" type="password" placeholder="Clave de acceso" autocomplete="off">'+
    '<button class="btn" style="width:100%;" id="gBtn">Entrar</button>'+
    '<div class="nota" style="margin-top:10px;"><a href="index.html">← volver al inicio</a></div></div></div>');
  $("gBtn").onclick=function(){
    var k=($("gKey").value||"").trim();
    if(k===CONFIG.VIEW_KEY){try{localStorage.setItem(UNLOCK_KEY,k);}catch(e){}var g=$("gate");g.parentNode.removeChild(g);cb();}
    else toast("Clave incorrecta",true);
  };
}
function pedirFin(cb){
  var g=$("gate");if(g)g.parentNode.removeChild(g);
  document.body.insertAdjacentHTML("beforeend",
    '<div id="gate"><div class="box"><div class="serif" style="font-size:22px;">Sección interna</div>'+
    '<div class="nota" style="margin-top:4px;">Esta página requiere la clave financiera. La valida el servidor.</div>'+
    '<input id="fKey" type="password" placeholder="Clave financiera" autocomplete="off">'+
    '<button class="btn" style="width:100%;" id="fBtn">Entrar</button>'+
    '<div class="nota" style="margin-top:10px;"><a href="index.html">← volver al inicio</a></div></div></div>');
  $("fBtn").onclick=function(){
    var k=($("fKey").value||"").trim();if(!k){toast("Escribe la clave",true);return;}
    fetchBoard(k,function(err,j){
      if(!err&&j.meta&&j.meta.incluye_financiero){
        try{sessionStorage.setItem(FIN_KEY,k);}catch(e){}
        FIN=k;DATA=j;setBadge("live","En vivo · interno");
        var g2=$("gate");if(g2)g2.parentNode.removeChild(g2);cb();
      } else toast("Clave financiera incorrecta",true);
    });
  };
}

/* Valida la clave del "Modo Dueño" contra el servidor, con el MISMO principio
   que la clave financiera (pedirFin): no se confía en lo que el usuario tecleó,
   se confía en lo que el servidor confirma. Antes, el prompt() guardaba
   cualquier texto y pintaba la barra de administración de inmediato: la clave
   real solo se comprobaba hasta el primer intento de guardar, ya con la barra
   abierta.

   Contesta una de tres, y la tercera importa: el Code.gs vivo TODAVIA no
   entiende el parámetro `admin=` (ese cambio se pega a mano en el editor de
   Apps Script y no está en este repo). Mientras no lo entienda, `es_admin`
   llega indefinido y decimos "nosabe" en vez de "no": si dijéramos "no",
   Alejandro se quedaría sin Modo Dueño el día que esto se publique. Con
   "nosabe" entra igual que hoy, pero avisado — y el día que el servidor
   aprenda a contestar, esta misma función se vuelve estricta sola.

   Lo que falta en el servidor: que `recurso=board` acepte `admin=<clave>` como
   ya acepta `fin=<clave>`, y devuelva `meta.es_admin` true o false. */
function validarAdmin(k,cb){
  var url=CONFIG.SHEET_URL+"?recurso=board&k="+encodeURIComponent(credencial())+"&admin="+encodeURIComponent(k)+"&cb="+Date.now();
  var ctrl=new AbortController();var to=setTimeout(function(){ctrl.abort();},FETCH_TIMEOUT);
  fetch(url,{signal:ctrl.signal,credentials:'omit'}).then(function(r){return r.json();}).then(function(j){
    clearTimeout(to);
    var v=j&&j.meta?j.meta.es_admin:undefined;
    cb(v===true?"si":(v===false?"no":"nosabe"));
  }).catch(function(){clearTimeout(to);cb("nosabe");});
}

/* ---------- nav común (inyectada: cero drift entre páginas) ---------- */
function pintarNav(){
  var el=$("nav");if(!el)return;
  var masOn=/^(cuentas|evidencia|direccion)$/.test(PAGE);
  var tabs='<a class="tab'+(PAGE==="index"?" on":"")+'" href="index.html"><i class="ti ti-home-2"></i>Inicio</a>'+
    '<a class="tab'+(PAGE==="tramites"?" on":"")+'" href="tramites.html"><i class="ti ti-checklist"></i>Trabajo</a>'+
    '<details class="navmore"><summary class="tab'+(masOn?" on":"")+'"><i class="ti ti-dots"></i>Más</summary><div class="navmenu">'+
      '<a href="cuentas.html"><b><i class="ti ti-wallet"></i> Cuentas <i class="ti ti-lock"></i></b><small>Presupuesto, pagos y costos</small></a>'+
      '<a href="evidencia.html"><b><i class="ti ti-photo"></i> Evidencia</b><small>Documentos, videos y bitácora</small></a>'+
      '<a href="direccion.html"><b><i class="ti ti-compass"></i> Dirección <i class="ti ti-lock"></i></b><small>Decisiones y control interno</small></a>'+
      '<a href="costos-oficiales.html"><b><i class="ti ti-receipt-tax"></i> Costos oficiales</b><small>Tarifas, UMA y fuentes verificables</small></a>'+
    '</div></details>';
  el.innerHTML='<header><div class="logo"><a href="index.html" style="text-decoration:none;color:inherit;"><span class="t serif">Real de Miramar</span></a>'+
    '<span class="sub">'+esc(OPTS.sub||"tablero del proyecto")+'</span></div>'+
    '<div class="hbtns"><nav class="tabs">'+tabs+"</nav>"+
    '<div id="badge" data-s="loading" title="Tocar para actualizar"><span class="dot"></span><span id="badgeTxt">Cargando</span></div></div></header>';
  $("badge").onclick=refrescar;
}
function setBadge(s,txt){var b=$("badge");if(!b)return;b.setAttribute("data-s",s);var t=$("badgeTxt");if(t)t.textContent=txt||s;}

/* ---------- selectores canónicos (una sola lógica en todo el sistema) ---------- */
function tabla(n){return (DATA&&DATA.tablas&&Array.isArray(DATA.tablas[n]))?DATA.tablas[n]:[];}
function config(k){return (DATA&&DATA.config&&DATA.config[k]!=null)?String(DATA.config[k]):"";}
function resumen(){return (DATA&&DATA.resumen)||{};}
function meta(){return (DATA&&DATA.meta)||{};}

function hitosOrd(){return tabla("HITOS").slice().sort(function(a,b){return (Number(a.orden)||0)-(Number(b.orden)||0);});}
function etapaActual(){
  var h=hitosOrd();
  for(var i=0;i<h.length;i++){if(clase(h[i].estado)!=="verde")return{cur:h[i],next:h[i+1]||null,idx:i,todos:h};}
  return{cur:null,next:null,idx:-1,todos:h};
}
function gatesDe(hid){return tabla("TRAMITES").filter(function(t){return String(t.paquete_etapa||"")===String(hid||"")&&/^si/i.test(String(t.gate||""));});}
function conteos(){
  var c={verde:0,amar:0,rojo:0,total:0};
  tabla("TRAMITES").forEach(function(t){var k=clase(t.estado);if(c[k]!=null)c[k]++;c.total++;});
  return c;
}
/* frontera = la ÚNICA respuesta a "¿qué sigue?": trámites no verdes cuyas
   dependencias (depende_de, IDs separados por coma) ya están todas en verde */
function frontera(n){
  var by={};tabla("TRAMITES").forEach(function(t){by[String(t.tramite_id).trim()]=t;});
  var out=tabla("TRAMITES").filter(function(t){
    if(clase(t.estado)==="verde")return false;
    if(String(t.ola||"").toUpperCase()==="COND")return false;
    var deps=String(t.depende_de||"").split(",").map(function(s){return s.trim();}).filter(Boolean);
    return deps.every(function(d){var p=by[d];return !p||clase(p.estado)==="verde";});
  });
  out.sort(function(a,b){
    var ua=/^si/i.test(String(a.urgente||""))?0:1, ub=/^si/i.test(String(b.urgente||""))?0:1;
    if(ua!==ub)return ua-ub;
    var ra=(String(a.ruta_critica||"")==="no")?1:0, rb=(String(b.ruta_critica||"")==="no")?1:0;
    if(ra!==rb)return ra-rb;
    return String(a.ola)<String(b.ola)?-1:1;
  });
  return n?out.slice(0,n):out;
}
function etaDe(t){
  var ini=String(t.fecha_inicio_est||"").trim(), dur=Number(t.duracion_sem);
  if(!ini||isNaN(dur)||dur<=0)return null;
  var d=new Date(ini+"T12:00:00");if(isNaN(d))return null;
  d.setDate(d.getDate()+dur*7);return d;
}
function fmtEta(d){if(!d)return"por estimar";return"~"+d.toLocaleDateString("es-MX",{month:"short",year:"numeric"})+" · estimado";}
function etaEtapa(hid){
  var max=null;gatesDe(hid).forEach(function(t){if(clase(t.estado)==="verde")return;var d=etaDe(t);if(d&&(!max||d>max))max=d;});
  return max;
}
/* puertas legales desde CUMPLIMIENTO (peor sub-paso por item) + sub-pasos */
function puertasCalc(){
  var rank={verde:3,amar:2,rojo:1},inv={3:"verde",2:"amar",1:"rojo"},m={},subs={};
  tabla("CUMPLIMIENTO").forEach(function(c){
    var item=String(c.item||"").trim();if(!item)return;
    var s=clase(c.semaforo||c.estado);var v=(s==="verde")?3:(s==="amar")?2:1;
    if(!(item in m)||v<m[item])m[item]=v;
    (subs[item]=subs[item]||[]).push(c);
  });
  return Object.keys(m).map(function(k){return{puerta:k,estado:inv[m[k]],subs:subs[k]};});
}
function ventaHabilitada(){var p=puertasCalc();return p.length>0&&p.every(function(x){return x.estado==="verde";});}
function videosPor(){
  var m={};tabla("VIDEOS").forEach(function(v){var k=String(v.tramite_id||"").trim();(m[k||"_gen"]=m[k||"_gen"]||[]).push(v);});
  return m;
}
function docsVigentes(){return tabla("DOCS").filter(function(x){return /^si/i.test(String(x.es_vigente||"").trim());});}
function docMeta(d){
  var n=String(d&&d.notas||""),m=n.match(/\[CANONICO:([^|\]]+)\|TRAMITES:([^|\]]*)\|IMPRIMIR:([^\]]+)\]/i);
  return m?{documento_id:m[1].trim(),tramites:m[2].split(",").map(function(x){return x.trim();}).filter(Boolean),listo_imprimir:m[3].trim()}:null;
}
function docUrl(d){
  var id=String(d&&d.doc_id||"").trim();
  if(/^https?:\/\//i.test(id))return id;
  return id?("https://drive.google.com/file/d/"+encodeURIComponent(id)+"/view"):"";
}
function docsDeTramite(id){
  id=String(id||"").trim();
  return docsVigentes().filter(function(d){var m=docMeta(d);return m&&(m.tramites.indexOf(id)>=0||m.tramites.indexOf("TODOS")>=0);});
}
function tramitePor(id){var t=null;tabla("TRAMITES").forEach(function(x){if(String(x.tramite_id).trim()===String(id).trim())t=x;});return t;}

/* ---------- escritura (solo dirección) ---------- */
function post(payload,cb){
  payload.request_id=payload.request_id||("web-"+Date.now());
  payload.k=credencial();   /* toda escritura viaja con la credencial del Portero; el servidor la valida */
  fetch(CONFIG.SHEET_URL,{method:"POST",body:JSON.stringify(payload),credentials:'omit'})
    .then(function(r){return r.text().then(function(t){return {s:r.status,t:t};});})
    .then(function(o){
      var j;
      try{ j=JSON.parse(o.t); }
      catch(_){
        /* respuesta no-JSON: sesión caducada o error del servidor, no un token críptico */
        cb(new Error(/sign in|accounts\.google/i.test(o.t)?"Tu sesión de Google caducó — recarga la página y vuelve a entrar.":(o.s>=400?("El servidor respondió con error "+o.s+"."):"Respuesta inesperada del servidor.")));
        return;
      }
      if(j&&j.error==="liga"){credencialRechazada();return;}
      cb(null,j);
    })
    .catch(function(){cb(new Error("Sin conexión con el servidor. Revisa tu internet e intenta de nuevo."));});
}

/* ---------- modal ---------- */
function modal(html){
  var ov=$("ov");
  if(!ov){document.body.insertAdjacentHTML("beforeend",'<div class="ov" id="ov"><div class="modal" id="modalBox"></div></div><div id="toast"></div>');ov=$("ov");
    ov.addEventListener("click",function(e){if(e.target===ov)cerrarModal();});
    document.addEventListener("keydown",function(e){if(e.key==="Escape")cerrarModal();});}
  $("modalBox").innerHTML='<span class="x" onclick="Board.cerrarModal()">×</span>'+html;
  ov.className="ov on";
}
function cerrarModal(){var ov=$("ov");if(ov)ov.className="ov";}

/* ---------- init ---------- */
function init(opts){
  OPTS=opts||{};PAGE=String(OPTS.page||"index");
  pintarNav();
  if(!$("toast"))document.body.insertAdjacentHTML("beforeend",'<div id="toast"></div>');
  var arranca=function(){cargar(function(){if(window.renderPage)window.renderPage(Board);});};
  if(OPTS.acceso==="clave"&&!unlocked()){porteroIntento(function(ok){if(ok)arranca();else pedirClave(arranca);});return;}
  arranca();
}

window.Board={init:init,tabla:tabla,config:config,resumen:resumen,meta:meta,
  hitosOrd:hitosOrd,etapaActual:etapaActual,gatesDe:gatesDe,conteos:conteos,
  frontera:frontera,etaDe:etaDe,fmtEta:fmtEta,etaEtapa:etaEtapa,
  puertasCalc:puertasCalc,ventaHabilitada:ventaHabilitada,videosPor:videosPor,
  docsVigentes:docsVigentes,docMeta:docMeta,docUrl:docUrl,docsDeTramite:docsDeTramite,tramitePor:tramitePor,
  lite:lite,unlocked:unlocked,fin:function(){return FIN;},post:post,validarAdmin:validarAdmin,
  modal:modal,cerrarModal:cerrarModal,toast:toast,refrescar:refrescar,
  $:$, esc:esc, money:money, clase:clase, fmtFecha:fmtFecha};
})();
