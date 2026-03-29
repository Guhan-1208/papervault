    const API_BASE = 'http://localhost:4000/api';

    // ═══════════════════════════════════════════════════════════════
    //  API FETCH WRAPPER
    // ═══════════════════════════════════════════════════════════════
    async function apiFetch(endpoint, options = {}) {
      const token = localStorage.getItem('pv_token');
      const headers = { ...options.headers };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (!(options.body instanceof FormData) && options.body && typeof options.body === 'object') {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
      }

      try {
        const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'API Error');
        return data;
      } catch (err) {
        showToast(err.message, 'error');
        throw err;
      }
    }

    let currentUser = null;
    let viewingPaper = null;
    let currentFile = null;
    let adminTab = 'pending';

    // ═══════════════════════════════════════════════════════════════
    //  AUTH
    // ═══════════════════════════════════════════════════════════════
    function switchAuthTab(tab) {
      document.querySelectorAll('.auth-tab').forEach((t, i) => t.classList.toggle('active', i === (tab === 'login' ? 0 : 1)));
      document.getElementById('panel-login').classList.toggle('active', tab === 'login');
      document.getElementById('panel-register').classList.toggle('active', tab === 'register');
    }

    function showAuthError(panel, msg) {
      const el = document.getElementById(panel + '-error');
      el.textContent = msg; el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 4000);
    }

    function fillDemo(role) {
      document.getElementById('login-email').value = role === 'admin' ? 'admin@college.edu' : 'student@demo.com';
      document.getElementById('login-password').value = role === 'admin' ? 'Admin@123' : 'demo123';
    }

    async function doLogin() {
      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const pass = document.getElementById('login-password').value;
      if (!email || !pass) { showAuthError('login', 'Please fill in all fields.'); return; }
      
      const btn = document.getElementById('login-btn');
      btn.disabled = true; btn.textContent = 'Signing in...';
      
      try {
        const data = await apiFetch('/auth/login', { method: 'POST', body: { email, password: pass } });
        localStorage.setItem('pv_token', data.token);
        currentUser = data.user;
        bootApp();
      } catch (err) {
        showAuthError('login', err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Sign In';
      }
    }

    async function doRegister() {
      const fname = document.getElementById('reg-fname').value.trim();
      const lname = document.getElementById('reg-lname').value.trim();
      const email = document.getElementById('reg-email').value.trim().toLowerCase();
      const dept = document.getElementById('reg-dept').value.trim();
      const pass = document.getElementById('reg-password').value;
      if (!fname || !lname || !email || !dept || !pass) { showAuthError('reg', 'Please fill in all fields.'); return; }
      if (pass.length < 6) { showAuthError('reg', 'Password must be at least 6 characters.'); return; }
      
      const btn = document.getElementById('reg-btn');
      btn.disabled = true; btn.textContent = 'Creating...';
      
      try {
        const data = await apiFetch('/auth/register', { method: 'POST', body: { fname, lname, email, dept, password: pass } });
        localStorage.setItem('pv_token', data.token);
        currentUser = data.user;
        bootApp();
      } catch (err) {
        showAuthError('reg', err.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
      }
    }

    function doLogout() {
      localStorage.removeItem('pv_token');
      currentUser = null;
      document.getElementById('app').classList.remove('active');
      document.getElementById('auth-screen').classList.add('active');
      showToast('Signed out successfully', 'success');
    }

    // ═══════════════════════════════════════════════════════════════
    //  BOOT
    // ═══════════════════════════════════════════════════════════════
    function bootApp() {
      document.getElementById('auth-screen').classList.remove('active');
      document.getElementById('app').classList.add('active');
      // Set user info
      const av = document.getElementById('sidebar-avatar');
      av.textContent = (currentUser.fname[0] + (currentUser.lname[0] || '')).toUpperCase();
      if (currentUser.role === 'admin') av.classList.add('admin');
      document.getElementById('sidebar-name').textContent = currentUser.fname + ' ' + currentUser.lname;
      document.getElementById('sidebar-role').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Student';
      // Show admin nav
      const isAdmin = currentUser.role === 'admin';
      document.getElementById('nav-admin').style.display = isAdmin ? 'flex' : 'none';
      document.getElementById('admin-sep').style.display = isAdmin ? 'block' : 'none';
      showPage('browse');
    }

    async function initSession() {
      const token = localStorage.getItem('pv_token');
      if (token) {
        try {
          currentUser = await apiFetch('/auth/me');
          bootApp();
        } catch (err) {
          localStorage.removeItem('pv_token');
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  NAVIGATION
    // ═══════════════════════════════════════════════════════════════
    function showPage(name) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('page-' + name).classList.add('active');
      const navEl = document.getElementById('nav-' + name);
      if (navEl) navEl.classList.add('active');
      if (name === 'browse') renderPapers();
      if (name === 'my-papers') renderMyPapers();
      if (name === 'admin') renderAdmin();
      if (name === 'upload') resetUploadForm();
    }

    // ═══════════════════════════════════════════════════════════════
    //  BROWSE
    // ═══════════════════════════════════════════════════════════════
    let queryTimeout = null;
    function handleSearch() {
      clearTimeout(queryTimeout);
      queryTimeout = setTimeout(renderPapers, 400);
    }

    async function updateFilters() {
      try {
        const { depts, years, sems } = await apiFetch('/papers/filters');
        
        const deptSel = document.getElementById('filter-dept');
        const yearSel = document.getElementById('filter-year');
        const selDept = deptSel.value, selYear = yearSel.value;
        
        deptSel.innerHTML = '<option value="">All Departments</option>' + depts.map(d => `<option value="${d}"${d === selDept ? ' selected' : ''}>${d}</option>`).join('');
        yearSel.innerHTML = '<option value="">All Years</option>' + years.map(y => `<option value="${y}"${y == selYear ? ' selected' : ''}>${y}</option>`).join('');
      } catch (e) {}
    }

    async function updateStats(papers) {
      if (currentUser?.role === 'admin') {
        try {
          const stats = await apiFetch('/admin/stats');
          document.getElementById('stat-total').textContent = stats.approved;
          // approximate others based on data
          const depts = new Set(papers.map(p => p.dept)).size;
          document.getElementById('stat-subjects').textContent = new Set(papers.map(p => p.subject)).size;
          document.getElementById('stat-depts').textContent = depts;
          const yearsList = papers.map(p => parseInt(p.year)).filter(Boolean);
          document.getElementById('stat-years').textContent = yearsList.length ? `${Math.min(...yearsList)}–${Math.max(...yearsList)}` : '—';
          document.getElementById('total-badge').textContent = stats.approved;
          
          const pb = document.getElementById('pending-badge');
          if (stats.pending > 0) { pb.style.display = 'inline-block'; pb.textContent = stats.pending; }
          else pb.style.display = 'none';
        } catch(e) {}
      } else {
        const years = papers.map(p => parseInt(p.year)).filter(Boolean);
        document.getElementById('stat-total').textContent = papers.length;
        document.getElementById('stat-subjects').textContent = new Set(papers.map(p => p.subject)).size;
        document.getElementById('stat-years').textContent = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—';
        document.getElementById('stat-depts').textContent = new Set(papers.map(p => p.dept)).size;
        document.getElementById('total-badge').textContent = papers.length;
      }
    }

    async function renderPapers() {
      const q = document.getElementById('search-input').value.trim();
      const dept = document.getElementById('filter-dept').value;
      const year = document.getElementById('filter-year').value;
      const sem = document.getElementById('filter-sem').value;
      
      let qStr = [];
      if (q) qStr.push(`q=${encodeURIComponent(q)}`);
      if (dept) qStr.push(`dept=${encodeURIComponent(dept)}`);
      if (year) qStr.push(`year=${encodeURIComponent(year)}`);
      if (sem) qStr.push(`semester=${encodeURIComponent(sem)}`);
      
      const grid = document.getElementById('papers-grid');
      grid.innerHTML = '<div class="loading-dots" style="grid-column:1/-1;justify-content:center;padding:40px;"><span></span><span></span><span></span></div>';
      
      try {
        const papers = await apiFetch(`/papers${qStr.length ? '?'+qStr.join('&') : ''}`);
        updateStats(papers);
        updateFilters();
        
        if (!papers.length) { grid.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><h3>No papers found</h3><p>Try adjusting your filters</p></div>`; return; }
        
        grid.innerHTML = papers.map(p => `
      <div class="paper-card" onclick="viewPaperById('${p.id}')">
        <div class="paper-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg></div>
        <div class="paper-title">${esc(p.subject)}</div>
        <div class="paper-meta">${esc(p.dept)}${p.code ? ' · ' + esc(p.code) : ''}</div>
        <div class="paper-tags"><span class="tag year">${p.year}</span><span class="tag sem">Sem ${p.semester}</span><span class="tag">${esc(p.exam_type)}</span></div>
        ${p.notes ? `<div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(p.notes)}</div>` : ''}
        <div class="paper-footer"><span>by ${esc(p.uploader_name || 'Unknown')}</span><button class="view-btn">View <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><polyline points="9,18 15,12 9,6"/></svg></button></div>
      </div>`).join('');
      } catch(e) {
        grid.innerHTML = `<div class="empty-state"><h3>Error loading papers</h3><p>${e.message}</p></div>`;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  MY PAPERS
    // ═══════════════════════════════════════════════════════════════
    async function renderMyPapers() {
      const tbody = document.getElementById('my-papers-tbody');
      const empty = document.getElementById('my-papers-empty');
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;"><div class="loading-dots" style="justify-content:center;"><span></span><span></span><span></span></div></td></tr>';
      empty.style.display = 'none';
      
      try {
        const mine = await apiFetch('/my/papers');
        if (!mine.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        
        tbody.innerHTML = mine.map(p => `
      <tr>
        <td class="subject-cell">${esc(p.subject)}${p.code ? `<span style="font-size:12px;color:var(--muted);margin-left:6px;">${esc(p.code)}</span>` : ''}</td>
        <td>${esc(p.dept)}</td>
        <td>${p.year} / Sem ${p.semester}</td>
        <td style="color:var(--muted);font-size:13px;">${formatDate(p.created_at)}</td>
        <td><span class="tag ${p.status}">${p.status}</span></td>
        <td><div class="action-btns"><button class="btn btn-secondary" onclick="viewPaperDirect(${JSON.stringify(p).replace(/"/g, '&quot;')})">View</button></div></td>
      </tr>`).join('');
      } catch(e) {}
    }

    // ═══════════════════════════════════════════════════════════════
    //  VIEWER
    // ═══════════════════════════════════════════════════════════════
    async function viewPaperById(id) {
      try {
        const paper = await apiFetch(`/papers/${id}`);
        viewPaperDirect(paper);
      } catch(e) {}
    }

    function viewPaperDirect(p) {
      viewingPaper = p;
      document.getElementById('view-title').textContent = p.subject;
      document.getElementById('view-meta').innerHTML = `
    <span><strong>${esc(p.dept)}</strong></span><span>·</span>
    <span>Year: <strong>${p.year}</strong></span><span>·</span>
    <span>Sem: <strong>${p.semester}</strong></span><span>·</span>
    <span>${esc(p.exam_type)}</span>
    ${p.code ? `<span>·</span><span>Code: <strong>${esc(p.code)}</strong></span>` : ''}
    <span>·</span><span>By <strong>${esc(p.uploader_name || 'Unknown')}</strong></span>`;
      const frame = document.getElementById('pdf-frame');
      frame.innerHTML = p.file_url
        ? `<iframe src="${p.file_url}" title="${esc(p.subject)}"></iframe>`
        : `<div style="text-align:center;color:var(--muted);padding:40px;">No PDF available</div>`;
      document.getElementById('viewer-modal').classList.add('open');
    }
    
    function closeViewer() { document.getElementById('viewer-modal').classList.remove('open'); viewingPaper = null; }
    function downloadPaper() {
      if (!viewingPaper?.file_url) { showToast('No file to download', 'error'); return; }
      const a = document.createElement('a'); a.href = viewingPaper.file_url; a.download = viewingPaper.file_name || 'paper.pdf'; a.click();
    }
    document.getElementById('viewer-modal').addEventListener('click', function (e) { if (e.target === this) closeViewer(); });

    // ═══════════════════════════════════════════════════════════════
    //  UPLOAD
    // ═══════════════════════════════════════════════════════════════
    function resetUploadForm() {
      ['up-subject', 'up-code', 'up-dept', 'up-year', 'up-notes'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('up-sem').value = '';
      document.getElementById('up-type').value = 'End Semester';
      document.getElementById('file-name-display').textContent = '';
      document.getElementById('file-input').value = '';
      currentFile = null;
    }
    function handleFileSelect(e) { const f = e.target.files[0]; if (f) setFile(f); }
    function handleDrag(e) { e.preventDefault(); document.getElementById('drop-zone').classList.add('dragover'); }
    function handleDragLeave() { document.getElementById('drop-zone').classList.remove('dragover'); }
    function handleDrop(e) {
      e.preventDefault(); document.getElementById('drop-zone').classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f && f.type === 'application/pdf') setFile(f); else showToast('Please drop a PDF file', 'error');
    }
    function setFile(file) { currentFile = file; document.getElementById('file-name-display').textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)'; }

    async function submitUpload() {
      if (!currentUser) { showToast('Please sign in first', 'error'); return; }
      const subject = document.getElementById('up-subject').value.trim();
      const dept = document.getElementById('up-dept').value.trim();
      const sem = document.getElementById('up-sem').value;
      const year = document.getElementById('up-year').value.trim();
      if (!subject || !dept || !sem || !year) { showToast('Please fill in all required fields', 'error'); return; }
      if (!currentFile) { showToast('Please select a PDF file', 'error'); return; }
      
      const btn = document.getElementById('upload-btn');
      btn.disabled = true; btn.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div> Uploading…';
      
      const fd = new FormData();
      fd.append('file', currentFile);
      fd.append('subject', subject);
      fd.append('code', document.getElementById('up-code').value.trim());
      fd.append('dept', dept);
      fd.append('semester', sem);
      fd.append('year', year);
      fd.append('exam_type', document.getElementById('up-type').value);
      fd.append('notes', document.getElementById('up-notes').value.trim());

      try {
        await apiFetch('/papers', { method: 'POST', body: fd });
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Submit for Review';
        resetUploadForm();
        showToast('Paper submitted for review!', 'success');
        showPage('my-papers');
      } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Submit for Review';
      }
    }

    // ═══════════════════════════════════════════════════════════════
    //  ADMIN PANEL
    // ═══════════════════════════════════════════════════════════════
    function switchAdminTab(tab) {
      adminTab = tab;
      document.querySelectorAll('.admin-tab').forEach((t, i) => {
        const tabs = ['pending', 'all-papers', 'users'];
        t.classList.toggle('active', tabs[i] === tab);
      });
      ['pending', 'all-papers', 'users'].forEach(t => {
        const el = document.getElementById('admin-tab-' + t);
        if (el) el.style.display = t === tab ? 'block' : 'none';
      });
      renderAdmin();
    }

    async function renderAdmin() {
      if (currentUser?.role !== 'admin') return;
      
      if (adminTab === 'pending') {
        const tbody = document.getElementById('pending-tbody');
        const empty = document.getElementById('pending-empty');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;"><div class="loading-dots" style="justify-content:center;"><span></span><span></span><span></span></div></td></tr>';
        
        try {
          const pending = await apiFetch('/admin/papers?status=pending');
          document.getElementById('pending-count-tab').textContent = pending.length || '';
          document.getElementById('pending-badge').textContent = pending.length;
          document.getElementById('pending-badge').style.display = pending.length > 0 ? 'inline-block' : 'none';
          
          if (!pending.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
          empty.style.display = 'none';
          tbody.innerHTML = pending.map(p => `
        <tr>
          <td class="subject-cell">${esc(p.subject)}${p.code ? `<br><span style="font-size:12px;color:var(--muted);">${esc(p.code)}</span>` : ''}</td>
          <td class="uploader-cell">${esc(p.uploader_name || 'Unknown')}</td>
          <td>${esc(p.dept)}<br><span style="font-size:12px;color:var(--muted);">${p.year} · Sem ${p.semester}</span></td>
          <td style="font-size:13px;color:var(--muted);">${formatDate(p.created_at)}</td>
          <td><div class="action-btns">
            <button class="btn btn-secondary" onclick="viewPaperDirect(${JSON.stringify(p).replace(/"/g, '&quot;')})">Preview</button>
            <button class="btn btn-success" onclick="setStatus('${p.id}','approved')">Approve</button>
            <button class="btn btn-danger" onclick="setStatus('${p.id}','rejected')">Reject</button>
          </div></td>
        </tr>`).join('');
        } catch(e) {}
      }

      if (adminTab === 'all-papers') {
        const tbody = document.getElementById('all-papers-tbody');
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;"><div class="loading-dots" style="justify-content:center;"><span></span><span></span><span></span></div></td></tr>';
        
        try {
          const papers = await apiFetch('/admin/papers');
          tbody.innerHTML = papers.map(p => `
        <tr>
          <td class="subject-cell">${esc(p.subject)}</td>
          <td class="uploader-cell">${esc(p.uploader_name || 'Unknown')}</td>
          <td>${esc(p.dept)} · ${p.year} · Sem ${p.semester}</td>
          <td><span class="tag ${p.status}">${p.status}</span></td>
          <td><div class="action-btns">
            <button class="btn btn-secondary" onclick="viewPaperDirect(${JSON.stringify(p).replace(/"/g, '&quot;')})">View</button>
            ${p.status !== 'approved' ? `<button class="btn btn-success" onclick="setStatus('${p.id}','approved')">Approve</button>` : ''}
            ${p.status !== 'rejected' ? `<button class="btn btn-danger" onclick="setStatus('${p.id}','rejected')">Reject</button>` : ''}
            <button class="btn btn-danger" onclick="deletePaper('${p.id}')">Delete</button>
          </div></td>
        </tr>`).join('');
        } catch(e) {}
      }

      if (adminTab === 'users') {
        const tbody = document.getElementById('users-tbody');
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;"><div class="loading-dots" style="justify-content:center;"><span></span><span></span><span></span></div></td></tr>';
        
        try {
          const users = await apiFetch('/admin/users');
          tbody.innerHTML = users.map(u => `<tr>
          <td><div style="display:flex;align-items:center;gap:10px;"><div class="avatar ${u.role === 'admin' ? 'admin' : ''}" style="width:28px;height:28px;font-size:11px;">${(u.fname[0] + (u.lname?.[0] || '')).toUpperCase()}</div>${esc(u.fname + ' ' + u.lname)}</div></td>
          <td style="color:var(--muted);font-size:13px;">${esc(u.email)}</td>
          <td>${esc(u.dept)}</td>
          <td style="font-size:13px;color:var(--muted);">${formatDate(u.created_at)}</td>
          <td><span class="tag ${u.role === 'admin' ? 'approved' : 'sem'}">${u.role}</span></td>
          <td style="text-align:center;">${u.upload_count}</td>
        </tr>`).join('');
        } catch(e) {}
      }
    }

    async function setStatus(id, status) {
      try {
        await apiFetch(`/admin/papers/${id}/status`, { method: 'PATCH', body: { status } });
        showToast(`Paper ${status === 'approved' ? 'approved and published' : 'rejected'}.`, status === 'approved' ? 'success' : 'error');
        renderAdmin();
      } catch(e) {}
    }

    async function deletePaper(id) {
      if (!confirm('Delete this paper permanently?')) return;
      try {
        await apiFetch(`/admin/papers/${id}`, { method: 'DELETE' });
        showToast('Paper deleted.', 'success');
        renderAdmin();
      } catch(e) {}
    }

    // ═══════════════════════════════════════════════════════════════
    //  UTILS
    // ═══════════════════════════════════════════════════════════════
    function formatDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function showToast(msg, type = 'success') {
      const t = document.getElementById('toast'), icon = document.getElementById('toast-icon');
      document.getElementById('toast-msg').textContent = msg;
      t.className = 'toast ' + type;
      icon.innerHTML = type === 'success' ? '<polyline points="20,6 9,17 4,12"/>' : '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>';
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 3200);
    }

    // ═══════════════════════════════════════════════════════════════
    //  INIT
    // ═══════════════════════════════════════════════════════════════
    initSession();
