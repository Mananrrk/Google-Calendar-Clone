/* app.js
   Updated to use backend API (CRUD) instead of localStorage.
   - fetches events for visible range on render
   - create / update / delete via API
   - adapts server event shape to frontend shape
*/

(function(){
  const API_BASE = 'http://localhost:5000/api';

  /* ---------- API helpers ---------- */
  async function apiFetchEvents(startISO, endISO) {
    const res = await fetch(`${API_BASE}/events?start=${encodeURIComponent(startISO)}&end=${encodeURIComponent(endISO)}`);
    if (!res.ok) throw new Error('Failed to fetch events: ' + (await res.text()));
    return res.json(); // array of server events
  }

  async function apiCreateEvent(payload) {
    const res = await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(()=>null);
    if (!res.ok) throw new Error((json && json.error) ? json.error : 'Create failed');
    return json; // { event, conflicts }
  }

  async function apiUpdateEvent(id, payload) {
    const res = await fetch(`${API_BASE}/events/${id}`, {
      method: 'PUT',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(()=>null);
    if (!res.ok) throw new Error((json && json.error) ? json.error : 'Update failed');
    return json; // { event, conflicts? }
  }

  async function apiDeleteEvent(id) {
    const res = await fetch(`${API_BASE}/events/${id}`, { method: 'DELETE' });
    const json = await res.json().catch(()=>null);
    if (!res.ok) throw new Error((json && json.error) ? json.error : 'Delete failed');
    return json;
  }

  function adaptServerEvent(ev) {
    // ev is server event with fields like _id, title, start_ts, end_ts, color
    return {
      id: ev._id || ev.id || ev._id,
      title: ev.title,
      start: ev.start_ts || ev.start,
      end: ev.end_ts || ev.end,
      color: ev.color || '#1a73e8',
      description: ev.description || '',
      raw: ev
    };
  }

  /* ---------- state ---------- */
  const state = {
    view: 'week', // month | week | day
    focus: new Date(),
    events: [] // loaded from server per visible range
  };

  /* ---------- elements ---------- */
  const monthView = document.getElementById('monthView');
  const weekView = document.getElementById('weekView');
  const dayView = document.getElementById('dayView');
  const monthGrid = document.getElementById('monthGrid');
  const weekHeader = document.getElementById('weekHeader');
  const weekBody = document.getElementById('weekBody');
  const titleLabel = document.getElementById('titleLabel');

  /* ---------- controls ---------- */
  document.querySelectorAll('.viewBtn').forEach(btn=>{
    btn.addEventListener('click', ()=> {
      document.querySelectorAll('.viewBtn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.view = btn.dataset.view;
      render(); // async, but no need to await here
    })
  });
  document.getElementById('todayBtn').addEventListener('click', ()=>{ state.focus = new Date(); render(); });
  document.getElementById('prevBtn').addEventListener('click', ()=>{ shift(-1); });
  document.getElementById('nextBtn').addEventListener('click', ()=>{ shift(1); });
  document.getElementById('newEventBtn').addEventListener('click', ()=> openModal({ start: new Date(), end: new Date(Date.now()+60*60*1000) }));

  function shift(dir){
    if(state.view==='month') state.focus.setMonth(state.focus.getMonth() + dir);
    else if(state.view==='week') state.focus.setDate(state.focus.getDate() + dir*7);
    else state.focus.setDate(state.focus.getDate() + dir);
    render();
  }

  // keep for compatibility (no-op because we persist in backend)
  function saveState(){ /* no-op: server-backed */ }

  /* ---------- Utilities ---------- */
  function startOfWeek(d){
    const copy = new Date(d);
    const day = (copy.getDay() + 6) % 7; // Monday=0
    copy.setHours(0,0,0,0);
    copy.setDate(copy.getDate() - day);
    return copy;
  }
  function addDays(d,n){ const c=new Date(d); c.setDate(c.getDate()+n); return c; }
  function sameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
  function iso(d){ return new Date(d).toISOString(); }
  function fmtMonth(d){ return d.toLocaleString(undefined,{month:'long',year:'numeric'}); }
  function uid(){ return 'evt_' + Math.random().toString(36).slice(2,9); }

  /* ---------- Range helpers & loader ---------- */
  function monthViewRange(focus) {
    const firstOfMonth = new Date(focus.getFullYear(), focus.getMonth(), 1);
    const start = startOfWeek(firstOfMonth);
    const end = addDays(start, 41); // 6 weeks grid
    // set end to end of day for server inclusive comparison
    end.setHours(23,59,59,999);
    return { start, end };
  }
  function weekViewRange(focus) {
    const start = startOfWeek(focus);
    const end = addDays(start,6);
    end.setHours(23,59,59,999);
    return { start, end };
  }
  async function loadEventsForVisibleRange(){
    try {
      let start, end;
      if (state.view === 'month') {
        ({start,end} = monthViewRange(state.focus));
      } else if (state.view === 'week') {
        ({start,end} = weekViewRange(state.focus));
      } else {
        start = new Date(state.focus); start.setHours(0,0,0,0);
        end = new Date(state.focus); end.setHours(23,59,59,999);
      }
      const serverEvents = await apiFetchEvents(start.toISOString(), end.toISOString());
      state.events = serverEvents.map(adaptServerEvent);
    } catch (err) {
      console.error('Failed to load events:', err);
      // keep existing events if fetch fails
      state.events = state.events || [];
    }
  }

  /* ---------- Rendering (async) ---------- */
  async function render(){
    document.title = 'Calendar — ' + fmtMonth(state.focus);
    titleLabel.textContent = state.view === 'month' ? fmtMonth(state.focus) : (state.view==='week' ? weekRangeLabel(state.focus) : state.focus.toDateString());

    // toggle views
    monthView.style.display = state.view === 'month' ? 'flex' : 'none';
    weekView.style.display = state.view === 'week' ? 'flex' : 'none';
    dayView.style.display = state.view === 'day' ? 'block' : 'none';

    // load events for visible range from server
    await loadEventsForVisibleRange();

    renderMonth();
    renderWeek();
  }

  // Month view
  function renderMonth(){
    monthGrid.innerHTML = '';
    const firstOfMonth = new Date(state.focus.getFullYear(), state.focus.getMonth(), 1);
    const start = startOfWeek(firstOfMonth);
    // show 6 weeks grid
    for(let i=0;i<42;i++){
      const d = addDays(start,i);
      const cell = document.createElement('div');
      cell.className = 'cell';
      if(d.getMonth() !== state.focus.getMonth()) cell.style.opacity = '0.45';

      const dateLabel = document.createElement('div');
      dateLabel.className = 'date';
      dateLabel.textContent = d.getDate();
      cell.appendChild(dateLabel);

      // events for day (from server-backed state.events)
      const dayEvents = state.events.filter(ev => {
        const s = new Date(ev.start);
        return sameDay(s,d);
      }).slice(0,3);

      dayEvents.forEach(ev=>{
        const chip = document.createElement('div');
        chip.className = 'chip';
        chip.textContent = ev.title;
        chip.title = ev.title;
        chip.style.background = ev.color || '#e8f0fe';
        // open modal for edit on click
        chip.addEventListener('click', (e)=> { e.stopPropagation(); openModal({ event: ev }); });
        cell.appendChild(chip);
      });

      // click to create
      cell.addEventListener('dblclick', ()=> {
        const start = new Date(d); start.setHours(9,0,0,0);
        const end = new Date(start.getTime()+60*60*1000);
        openModal({ start, end });
      });

      monthGrid.appendChild(cell);
    }
  }

  // Week view
  function weekRangeLabel(focus){
    const s = startOfWeek(focus);
    const e = addDays(s,6);
    const a = s.toLocaleDateString(undefined,{month:'short',day:'numeric'});
    const b = e.toLocaleDateString(undefined,{month:'short',day:'numeric',year: e.getFullYear() !== s.getFullYear() ? 'numeric' : undefined});
    return a + ' — ' + b;
  }

  function renderWeek(){
    weekHeader.innerHTML = '';
    weekBody.innerHTML = '';

    // header: hours col + 7 days
    const hoursHeader = document.createElement('div'); hoursHeader.className='hour-col';
    weekHeader.appendChild(hoursHeader);

    const s = startOfWeek(state.focus);
    for(let i=0;i<7;i++){
      const d = addDays(s,i);
      const hdr = document.createElement('div'); hdr.className='day-col-header';
      hdr.textContent = d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
      weekHeader.appendChild(hdr);
    }

    // body: hours column + day columns
    const hoursCol = document.createElement('div'); hoursCol.className='hours';
    for(let h=0;h<24;h++){
      const hr = document.createElement('div'); hr.className='hour'; hr.textContent = h + ':00';
      hoursCol.appendChild(hr);
    }
    weekBody.appendChild(hoursCol);

    for(let i=0;i<7;i++){
      const d = addDays(s,i);
      const dayCol = document.createElement('div'); dayCol.className = 'day-col';
      // Add slot rows (visual)
      for(let h=0;h<24;h++){
        const slot = document.createElement('div'); slot.className='slot';
        dayCol.appendChild(slot);
      }

      // Place events from state.events
      const dayEvents = state.events.filter(ev => sameDay(new Date(ev.start), d));
      dayEvents.forEach(ev=>{
        const sdt = new Date(ev.start), edt = new Date(ev.end);
        // clamp in hours
        const startHours = sdt.getHours() + sdt.getMinutes()/60;
        const endHours = edt.getHours() + edt.getMinutes()/60;
        const topPx = startHours * 40; // 40px per hour (same as .hour height)
        const heightPx = Math.max(20, (endHours - startHours) * 40);

        const node = document.createElement('div');
        node.className = 'evt';
        node.style.top = topPx + 'px';
        node.style.height = heightPx + 'px';
        node.textContent = ev.title;
        node.style.background = ev.color || 'linear-gradient(180deg,#dbeafe,#93c5fd)';
        node.addEventListener('click', (e)=> { e.stopPropagation(); openModal({ event: ev }); });
        dayCol.appendChild(node);
      });

      // create by click
      dayCol.addEventListener('dblclick', (ev)=> {
        const rect = dayCol.getBoundingClientRect();
        const y = ev.clientY - rect.top;
        const hour = Math.floor(y/40);
        const start = new Date(d); start.setHours(hour,0,0,0);
        const end = new Date(start.getTime() + 60*60*1000);
        openModal({ start, end });
      });

      weekBody.appendChild(dayCol);
    }
  }

  /* ---------- Modal: create / edit (now using API) ---------- */
  function openModal({start, end, event}){
    const root = document.getElementById('modalRoot');
    root.style.display = 'block';
    root.innerHTML = `
      <div class="backdrop" id="backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h3>${event ? 'Edit event' : 'Create event'}</h3>
          <input id="evTitle" class="input" placeholder="Event title" value="${event ? escapeHtml(event.title) : ''}" />
          <div class="row">
            <div style="flex:1">
              <label style="font-size:12px;color:var(--muted)">Start</label>
              <input id="evStart" class="input" type="datetime-local" value="${toLocalInputValue(event ? new Date(event.start) : start)}"/>
            </div>
            <div style="flex:1">
              <label style="font-size:12px;color:var(--muted)">End</label>
              <input id="evEnd" class="input" type="datetime-local" value="${toLocalInputValue(event ? new Date(event.end) : end)}"/>
            </div>
          </div>
          <div style="margin-top:8px">
            <label style="font-size:12px;color:var(--muted)">Color</label>
            <input id="evColor" class="input" type="color" value="${event ? (event.color || '#1a73e8') : '#1a73e8'}" />
          </div>
          <div style="display:flex;justify-content:flex-end;margin-top:12px;gap:8px">
            ${event ? `<button id="deleteBtn" class="btn" style="background:#fff;border-color:#f87171;color:#b91c1c">Delete</button>` : ''}
            <button id="cancelBtn" class="btn">Cancel</button>
            <button id="saveBtn" class="btn primary">${event ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </div>
    `;
    // handlers
    document.getElementById('cancelBtn').onclick = closeModal;
    document.getElementById('backdrop').onclick = (e)=> { if(e.target.id==='backdrop') closeModal(); };

    document.getElementById('saveBtn').onclick = async ()=> {
      try {
        const title = document.getElementById('evTitle').value.trim() || 'Untitled';
        const s = new Date(document.getElementById('evStart').value);
        const e = new Date(document.getElementById('evEnd').value);
        const color = document.getElementById('evColor').value;

        if (isNaN(s.getTime()) || isNaN(e.getTime())) { alert('Invalid start or end'); return; }
        if (s >= e) { alert('End must be after start'); return; }

        if(event){
          // update existing event via API
          const payload = { title, description: event.description || '', start_ts: s.toISOString(), end_ts: e.toISOString(), color };
          const result = await apiUpdateEvent(event.id, payload); // { event, conflicts }
          // optionally handle result.conflicts (not shown)
        } else {
          // create new event via API
          const payload = { title, description: '', start_ts: s.toISOString(), end_ts: e.toISOString(), color };
          const result = await apiCreateEvent(payload); // { event, conflicts }
        }

        // refresh visible events and UI
        await loadEventsForVisibleRange();
        closeModal();
        render();
      } catch (err) {
        console.error('Save failed', err);
        alert('Failed to save event: ' + err.message);
      }
    };

    if(event){
      document.getElementById('deleteBtn').onclick = async ()=> {
        if(!confirm('Delete this event?')) return;
        try {
          await apiDeleteEvent(event.id);
          await loadEventsForVisibleRange();
          closeModal();
          render();
        } catch(err) {
          console.error('Delete failed', err);
          alert('Failed to delete: ' + err.message);
        }
      };
    }
  }

  function closeModal(){
    const root = document.getElementById('modalRoot');
    root.style.display = 'none';
    root.innerHTML = '';
  }

  function toLocalInputValue(d){
    if(!d) return '';
    const tzOffset = d.getTimezoneOffset()*60000;
    const local = new Date(d.getTime() - tzOffset);
    return local.toISOString().slice(0,16);
  }
  function escapeHtml(s){ return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }

  // initial render (async)
  render();

  // expose for debugging
  window._CAL = { state, render, loadEventsForVisibleRange };
})();
