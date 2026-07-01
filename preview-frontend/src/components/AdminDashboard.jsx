import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Home, QrCode, LogOut, Check, X, Trash2 } from 'lucide-react';

const AdminDashboard = () => {
  const [activeTab, setActiveTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [properties, setProperties] = useState([]);
  const [botStatus, setBotStatus] = useState({ ready: false });
  const [loading, setLoading] = useState(true);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  
  const navigate = useNavigate();
  const token = localStorage.getItem('adminToken');
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  useEffect(() => {
    if (!token) {
      navigate('/admin/login');
      return;
    }
    fetchData();
    const interval = setInterval(fetchBotStatus, 5000);
    return () => clearInterval(interval);
  }, [token, navigate]);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchProperties(), fetchBotStatus()]);
    setLoading(false);
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (res.status === 401) { navigate('/admin/login'); return; }
      const data = await res.json();
      setUsers(data);
    } catch (e) { console.error('Failed to fetch users', e); }
  };

  const fetchProperties = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/properties`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await res.json();
      setProperties(data);
    } catch (e) { console.error('Failed to fetch properties', e); }
  };

  const fetchBotStatus = async () => {
    try {
      const res = await fetch(`${apiUrl}/api/admin/status`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const data = await res.json();
      setBotStatus(data);
    } catch (e) { console.error('Failed to fetch bot status', e); }
  };

  const updateUserStatus = async (id, status) => {
    try {
      await fetch(`${apiUrl}/api/admin/users/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      fetchUsers();
    } catch (e) { console.error('Failed to update user', e); }
  };

  const deleteProperty = async (id) => {
    if (!window.confirm('Are you sure you want to delete this listing?')) return;
    try {
      await fetch(`${apiUrl}/api/admin/properties/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchProperties();
    } catch (e) { console.error('Failed to delete property', e); }
  };

  const requestPairingCode = async () => {
    if (!phoneNumber) return alert('Please enter a phone number');
    setRequestingCode(true);
    setPairingCode('');
    try {
      const res = await fetch(`${apiUrl}/api/admin/pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ phoneNumber })
      });
      const data = await res.json();
      if (data.code) {
        setPairingCode(data.code);
      } else {
        alert(data.error || 'Failed to get pairing code');
      }
    } catch (e) {
      console.error(e);
      alert('Error requesting pairing code');
    }
    setRequestingCode(false);
  };

  const logout = () => {
    localStorage.removeItem('adminToken');
    navigate('/admin/login');
  };

  if (loading) return <div className="container" style={{textAlign:'center', marginTop:'20vh'}}><h2>Loading Admin Dashboard...</h2></div>;

  return (
    <div className="container pb-10">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <h1 style={{ margin: 0 }}>Admin Panel</h1>
        <button className="btn" onClick={logout} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)' }}>
          <LogOut size={18} style={{ display: 'inline', marginRight: '0.5rem' }}/> Logout
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', overflowX: 'auto' }}>
        <button className={`btn ${activeTab === 'users' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('users')} style={activeTab !== 'users' ? {background: 'rgba(255,255,255,0.1)'} : {}}>
          <Users size={18} style={{ display: 'inline', marginRight: '0.5rem' }}/> Users
        </button>
        <button className={`btn ${activeTab === 'properties' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('properties')} style={activeTab !== 'properties' ? {background: 'rgba(255,255,255,0.1)'} : {}}>
          <Home size={18} style={{ display: 'inline', marginRight: '0.5rem' }}/> Listings
        </button>
        <button className={`btn ${activeTab === 'bot' ? 'btn-primary' : ''}`} onClick={() => setActiveTab('bot')} style={activeTab !== 'bot' ? {background: 'rgba(255,255,255,0.1)'} : {}}>
          <QrCode size={18} style={{ display: 'inline', marginRight: '0.5rem' }}/> WhatsApp Status
        </button>
      </div>

      <div className="glass animate-fade-in" style={{ padding: '2rem' }}>
        {activeTab === 'users' && (
          <div>
            <h2 style={{ marginBottom: '1.5rem' }}>Platform Users ({users.length})</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                    <th style={{ padding: '1rem' }}>Phone / ID</th>
                    <th style={{ padding: '1rem' }}>Role</th>
                    <th style={{ padding: '1rem' }}>Status</th>
                    <th style={{ padding: '1rem' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <td style={{ padding: '1rem' }}>{u.id.replace('@c.us', '')}</td>
                      <td style={{ padding: '1rem' }}>{u.role}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ 
                          padding: '0.25rem 0.5rem', 
                          borderRadius: '12px', 
                          fontSize: '0.85rem',
                          background: u.status === 'approved' ? 'rgba(16, 185, 129, 0.2)' : u.status === 'blocked' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: u.status === 'approved' ? '#34d399' : u.status === 'blocked' ? '#f87171' : '#fbbf24'
                        }}>
                          {u.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
                        {u.status !== 'approved' && (
                          <button onClick={() => updateUserStatus(u.id, 'approved')} style={{ background: '#10b981', border: 'none', borderRadius: '4px', padding: '0.5rem', cursor: 'pointer', color: 'white' }} title="Approve">
                            <Check size={16} />
                          </button>
                        )}
                        {u.status !== 'blocked' && u.role !== 'admin' && (
                          <button onClick={() => updateUserStatus(u.id, 'blocked')} style={{ background: '#ef4444', border: 'none', borderRadius: '4px', padding: '0.5rem', cursor: 'pointer', color: 'white' }} title="Block">
                            <X size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan="4" style={{ padding: '1rem', textAlign: 'center' }}>No users found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'properties' && (
          <div>
            <h2 style={{ marginBottom: '1.5rem' }}>Active Listings ({properties.length})</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
              {properties.map(p => {
                const images = JSON.parse(p.images || '[]');
                return (
                  <div key={p.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1rem', position: 'relative' }}>
                    <img src={images[0]} alt={p.title} style={{ width: '100%', height: '150px', objectFit: 'cover', borderRadius: '8px', marginBottom: '1rem' }} />
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.1rem' }}>{p.title}</h3>
                    <p style={{ margin: '0 0 0.5rem 0', color: 'var(--color-primary)', fontWeight: 'bold' }}>{p.price}</p>
                    <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: '#9ca3af' }}>Listed by: {p.agent_name}</p>
                    
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => window.open(`/preview/${p.id}`, '_blank')} className="btn btn-primary" style={{ flex: 1, padding: '0.5rem' }}>View</button>
                      <button onClick={() => deleteProperty(p.id)} style={{ background: '#ef4444', border: 'none', borderRadius: '8px', padding: '0.5rem 1rem', cursor: 'pointer', color: 'white' }}>
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {properties.length === 0 && <p>No properties listed yet.</p>}
            </div>
          </div>
        )}

        {activeTab === 'bot' && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: '1.5rem' }}>WhatsApp Bot Connection</h2>
            
            {botStatus.ready ? (
              <div style={{ padding: '3rem', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                <Check size={64} color="#10b981" style={{ margin: '0 auto 1rem auto' }} />
                <h3>Bot is Authenticated and Online!</h3>
                <p style={{ color: '#a7f3d0' }}>The WhatsApp bot is actively receiving and processing messages.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', justifyContent: 'center' }}>
                {/* QR Code Section */}
                {botStatus.qr && (
                  <div style={{ padding: '2rem', background: '#f9fafb', borderRadius: '12px', border: '1px solid #e5e7eb', flex: '1 1 300px' }}>
                    <h3 style={{ marginBottom: '1rem' }}>Option 1: Scan QR Code</h3>
                    <div style={{ background: 'white', padding: '1rem', display: 'inline-block', borderRadius: '12px', marginBottom: '1rem' }}>
                      <img src={botStatus.qr} alt="Scan QR" style={{ width: '220px', height: '220px' }} />
                    </div>
                    <p style={{ color: '#4b5563', fontSize: '0.9rem' }}>Open WhatsApp &gt; Linked Devices &gt; Link a Device</p>
                  </div>
                )}

                {/* Phone Pairing Section */}
                <div style={{ padding: '2rem', background: '#f9fafb', borderRadius: '12px', border: '1px solid #e5e7eb', flex: '1 1 300px' }}>
                  <h3 style={{ marginBottom: '1rem' }}>Option 2: Phone Number</h3>
                  <p style={{ marginBottom: '1.5rem', color: '#4b5563', fontSize: '0.9rem' }}>
                    Enter your phone number (e.g. 919876543210) to get an 8-character pairing code.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                    <input
                      type="text"
                      placeholder="919876543210"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      style={{ padding: '0.75rem', borderRadius: '8px', border: '2px solid #000', background: 'white', color: '#000', fontSize: '1rem', fontWeight: 'bold' }}
                    />
                    <button className="btn btn-primary" onClick={requestPairingCode} disabled={requestingCode} style={{ padding: '0.75rem' }}>
                      {requestingCode ? 'Requesting...' : 'Get Pairing Code'}
                    </button>
                  </div>
                  
                  {pairingCode && (
                    <div>
                      <div style={{ padding: '1rem', background: 'white', display: 'inline-block', borderRadius: '12px', marginBottom: '1rem', border: '2px dashed #10b981' }}>
                        <h1 style={{ color: '#000', fontSize: '2.5rem', letterSpacing: '0.2em', margin: 0 }}>
                          {pairingCode}
                        </h1>
                      </div>
                      <p style={{ color: '#4b5563', fontSize: '0.9rem' }}>
                        Open WhatsApp &gt; Linked Devices &gt; Link with phone number instead. Enter the code above.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
