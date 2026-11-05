/* Independent of task alarms and main-section navigation. */
(() => {
  const WORK = 20 * 60 * 1000, REST = 20 * 1000;
  let phase = 'idle', remaining = WORK, deadline = 0, preview = 0, generation = 0;
  const panel = document.createElement('dialog');
  panel.id = 'eyeReminder';
  panel.setAttribute('aria-labelledby', 'eyeHeading');
  panel.innerHTML = `<button type="button" id="eyeClose" aria-label="Закрити" style="float:right">✕</button>
    <h2 id="eyeHeading">🌷 Турбота про зір</h2>
    <div id="eyeClock" style="font-size:clamp(42px,10vw,64px);font-variant-numeric:tabular-nums">20:00</div>
    <p id="eyeNotice" role="status">Кожні 20 хвилин — нагадування зі звуком.</p>
    <button type="button" id="eyeToggle">▶ Почати зі звуком</button>
    <button type="button" id="eyeRest" hidden>Почати паузу · вимкнути дзвінок</button>
    <button type="button" id="eyeReset">↻ Спочатку</button>
    <p><button type="button" id="eyeTest">🔔 Перевірити звук</button></p>
    <label>Гучність <input id="eyeVolume" aria-label="Гучність будильника" type="range" min="0.1" max="1" step="0.1" value="0.8"></label>
    <p><small>20 секунд погляду вдалину та 5 повільних моргань. Дзвінок повторюється, доки ти не почнеш паузу.</small></p>
    <p><small>Залиш застосунок відкритим і звук пристрою увімкненим. Можна переходити між розділами. Сон пристрою або призупинення вкладки браузером можуть затримати сигнал.</small></p>`;
  panel.style.cssText = 'box-sizing:border-box;width:min(94vw,480px);max-height:90vh;overflow:auto;border:1px solid #df8c8e;border-radius:24px;padding:24px;background:#fff7f1;color:#543b45;text-align:center';
  document.body.append(panel);
  const $ = id => document.getElementById(id);
  const nav = $('eyeReminderNav');
  // A self-contained repeating bell; no network or third-party audio dependency.
  const rate = 16000, samples = rate * 3, buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
  const word = (offset, value) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  word(0,'RIFF'); view.setUint32(4,36+samples*2,true); word(8,'WAVE'); word(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  word(36,'data'); view.setUint32(40,samples*2,true);
  for(let i=0;i<samples;i++) { const t=i/rate, part=t%0.45;
    const tone=t<1.35 ? Math.sin(2*Math.PI*(t<0.45?660:t<0.9?830:990)*t)*Math.min(1,part/0.015)*Math.exp(-part*7)*0.65 : 0;
    view.setInt16(44+i*2,tone*32767,true);
  }
  const audio = new Audio(URL.createObjectURL(new Blob([buffer],{type:'audio/wav'})));
  audio.loop = true; audio.volume = 0.8;
  function stopSound() { clearTimeout(preview); audio.pause(); audio.currentTime=0; }
  async function play() { try { await audio.play(); return true; } catch { $('eyeNotice').textContent='Звук заблоковано. Натисни «Перевірити звук» та перевір гучність пристрою.'; return false; } }
  function open() { if (!panel.open) panel.showModal(); }
  function draw() {
    const ms=(phase==='work'||phase==='rest') ? Math.max(0,deadline-Date.now()) : remaining;
    const secs=Math.ceil(ms/1000);
    $('eyeClock').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');
    $('eyeRest').hidden=phase!=='alarm'; $('eyeToggle').hidden=phase==='alarm'||phase==='rest';
    $('eyeToggle').textContent=phase==='work'?'Ⅱ Пауза':'▶ Почати зі звуком';
    if(nav) nav.textContent=phase==='alarm'?'🔔 Час подбати про зір!':phase==='work'?'👀 Турбота про зір · '+$('eyeClock').textContent:'👀 Турбота про зір';
  }
  function tick() {
    if(phase==='work' && Date.now()>=deadline) {
      phase='alarm'; remaining=0; stopSound();
      $('eyeNotice').textContent='Час подбати про зір. Почни паузу, коли почуєш дзвінок ♡'; open(); void play();
    } else if(phase==='rest' && Date.now()>=deadline) {
      phase='work'; remaining=WORK; deadline=Date.now()+WORK;
      $('eyeNotice').textContent='Наступне нагадування — через 20 хвилин ♡';
    }
    draw();
  }
  $('eyeToggle').onclick=async () => {
    if(phase==='work') { remaining=Math.max(0,deadline-Date.now()); phase='paused'; stopSound(); $('eyeNotice').textContent='Таймер на паузі ♡'; draw(); return; }
    // Start media directly in the user's click; do not start a silent timer if blocked.
    const attempt=++generation; $('eyeToggle').disabled=true;
    const ok=await play(); $('eyeToggle').disabled=false;
    if(attempt!==generation) { stopSound(); return; }
    if(!ok) return;
    phase='work'; deadline=Date.now()+remaining;
    $('eyeNotice').textContent='Звук увімкнено. Я нагадаю про паузу ♡';
    preview=setTimeout(stopSound,1400); draw();
  };
  $('eyeRest').onclick=()=>{stopSound();phase='rest';deadline=Date.now()+REST;$('eyeNotice').textContent='Подивись удалину й повільно моргни 5 разів.';draw();};
  $('eyeReset').onclick=()=>{generation++;stopSound();phase='idle';remaining=WORK;$('eyeNotice').textContent='Кожні 20 хвилин — нагадування зі звуком.';draw();};
  $('eyeTest').onclick=async()=>{if(phase==='alarm'){await play();return;}const attempt=generation;stopSound();const ok=await play();if(attempt!==generation){stopSound();return;}if(ok && phase!=='alarm')preview=setTimeout(stopSound,3000);};
  $('eyeVolume').oninput=e=>{audio.volume=Number(e.target.value);};
  $('eyeClose').onclick=()=>panel.close();
  if(nav) nav.onclick=open;
  document.addEventListener('visibilitychange',tick);
  window.addEventListener('pageshow',tick);
  window.addEventListener('pagehide',stopSound);
  setInterval(tick,500); draw();
  if(document.body.dataset.eyeStandalone==='true') open();
})();
