import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Send, User, CheckCircle2, MapPin, FileText, ChevronLeft, ChevronRight, Info } from 'lucide-react';

const PropertyPreview = () => {
  const { id } = useParams();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', phone: '', offerPrice: '', message: '' });
  const [submitStatus, setSubmitStatus] = useState('idle');
  
  const [currentImgIndex, setCurrentImgIndex] = useState(0);

  useEffect(() => {
    const fetchProperty = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
        const res = await fetch(`${apiUrl}/api/property/${id}`);
        if (!res.ok) throw new Error('Property not found');
        const data = await res.json();
        // Normalize for backwards compatibility (old items had 'image', new have 'images')
        if (data.image && !data.images) data.images = [data.image];
        if (!data.documents) data.documents = [];
        setProperty(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchProperty();
  }, [id]);

  const handleOfferSubmit = async (e) => {
    e.preventDefault();
    setSubmitStatus('submitting');
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/api/offer/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (!res.ok) throw new Error('Failed to submit offer');
      setSubmitStatus('success');
      setTimeout(() => {
        setShowModal(false);
        setSubmitStatus('idle');
      }, 3000);
    } catch (err) {
      setSubmitStatus('error');
    }
  };

  const nextImg = () => setCurrentImgIndex((prev) => (prev + 1) % property.images.length);
  const prevImg = () => setCurrentImgIndex((prev) => (prev - 1 + property.images.length) % property.images.length);

  if (loading) return <div className="container" style={{textAlign:'center', marginTop:'20vh'}}><h2 className="animate-fade-in">Loading Exclusive Property...</h2></div>;
  if (error) return <div className="container" style={{textAlign:'center', marginTop:'20vh'}}><h2>{error}</h2></div>;
  if (!property) return null;

  return (
    <div className="container pb-10">
      {/* Image Gallery */}
      <div className="gallery-container animate-fade-in" style={{ position: 'relative', marginBottom: '2rem' }}>
        <img 
          src={property.images[currentImgIndex]} 
          alt={property.title} 
          className="hero-image" 
          style={{ marginBottom: 0 }} 
        />
        {property.images.length > 1 && (
          <>
            <button onClick={prevImg} className="gallery-nav left"><ChevronLeft size={32} /></button>
            <button onClick={nextImg} className="gallery-nav right"><ChevronRight size={32} /></button>
            <div className="gallery-indicator">
              {currentImgIndex + 1} / {property.images.length}
            </div>
          </>
        )}
      </div>
      
      {/* Property Details Card */}
      <div className="glass property-details animate-fade-in delay-1">
        <h1>{property.title}</h1>
        <h2>{property.price}</h2>
        
        <div style={{display:'flex', alignItems:'center', gap:'0.5rem', margin:'1rem 0', color:'var(--color-primary)'}}>
          <MapPin size={20} />
          <span>{property.location || 'Location Not Specified'}</span>
        </div>

        {property.otherInfo && (
          <div className="other-info-box">
            <Info size={20} color="var(--color-primary)" />
            <span>{property.otherInfo}</span>
          </div>
        )}
        
        <p style={{marginTop:'1.5rem', fontSize:'1.1rem'}}>{property.description}</p>
        
        <div style={{marginTop:'2rem'}}>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Send size={20} /> Make an Offer / Contact Agent
          </button>
        </div>
      </div>

      {/* Documents Section */}
      {property.documents.length > 0 && (
        <div className="glass property-details animate-fade-in delay-2" style={{marginTop: '2rem'}}>
          <h3 style={{marginTop: 0, marginBottom: '1.5rem', color: 'var(--color-primary)'}}>Attached Documents</h3>
          <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
            {property.documents.map((doc, idx) => (
              <a key={idx} href={doc.url} target="_blank" rel="noreferrer" className="document-link">
                <FileText size={24} />
                <span>{doc.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Agent Profile Card */}
      <div className="glass agent-profile animate-fade-in delay-3">
        <div className="agent-avatar">
          <User size={30} />
        </div>
        <div>
          <h3 style={{margin:0, fontSize:'1.2rem'}}>{property.agentName || 'Listed by Exclusive Agent'}</h3>
          <p style={{margin:0, marginTop:'0.25rem'}}>📞 {property.agentPhone || 'Contact agent to learn more'}</p>
        </div>
      </div>

      {/* Offer Modal */}
      {showModal && (
        <div className="modal-overlay animate-fade-in">
          <div className="glass modal-content">
            <button className="close-button" onClick={() => setShowModal(false)}>×</button>
            <h2 style={{marginBottom:'1.5rem'}}>Contact Agent / Offer</h2>
            
            {submitStatus === 'success' ? (
              <div style={{textAlign:'center', padding:'2rem 0', color:'var(--color-primary)'}}>
                <CheckCircle2 size={60} style={{margin:'0 auto', marginBottom:'1rem'}} />
                <h3>Offer Sent Successfully!</h3>
                <p>The agent will be in touch shortly via WhatsApp.</p>
              </div>
            ) : (
              <form onSubmit={handleOfferSubmit}>
                <div>
                  <label style={{display:'block', marginBottom:'0.5rem'}}>Full Name</label>
                  <input type="text" required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="John Doe" />
                </div>
                <div>
                  <label style={{display:'block', marginBottom:'0.5rem'}}>Phone Number</label>
                  <input type="tel" required value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} placeholder="+1 234 567 8900" />
                </div>
                <div>
                  <label style={{display:'block', marginBottom:'0.5rem'}}>Offer Price / Enquiry</label>
                  <input type="text" required value={formData.offerPrice} onChange={e => setFormData({...formData, offerPrice: e.target.value})} placeholder="e.g. $1,200,000" />
                </div>
                <div>
                  <label style={{display:'block', marginBottom:'0.5rem'}}>Message to Agent</label>
                  <textarea rows="3" value={formData.message} onChange={e => setFormData({...formData, message: e.target.value})} placeholder="I am highly interested in this property..."></textarea>
                </div>
                <button type="submit" className="btn btn-primary" disabled={submitStatus === 'submitting'}>
                  {submitStatus === 'submitting' ? 'Sending...' : 'Send to Agent via WhatsApp'}
                </button>
                {submitStatus === 'error' && <p style={{color:'red', marginTop:'1rem'}}>Failed to send offer. Please try again.</p>}
              </form>
            )}
          </div>
        </div>
      )}
      {/* Footer / Branding */}
      <footer style={{ marginTop: '3rem', textAlign: 'center', padding: '2rem 0', borderTop: '1px solid rgba(5,150,105,0.2)', color: 'var(--color-text-muted)' }}>
        <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>*Terms and conditions apply.</p>
        <p style={{ fontSize: '0.9rem', margin: '0' }}>
          Built by <strong>Vashu Sangwan Web Solutions</strong>. 
          <br/>
          <a 
            href="https://wa.me/919996829482?text=I%20want%20to%20get%20my%20own%20free%20Property%20CRM%20bot!" 
            target="_blank" 
            rel="noreferrer"
            style={{ color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 'bold', display: 'inline-block', marginTop: '0.5rem' }}
          >
            Get Yours now for free!
          </a>
        </p>
      </footer>
    </div>
  );
};

export default PropertyPreview;
