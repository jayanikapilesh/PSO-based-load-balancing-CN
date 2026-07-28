import React, { useState } from 'react';
import BehaviorAuthentication from './pages/BehaviorAuthentication';
import AdminIntegrityDashboard from './pages/AdminIntegrityDashboard';
import './index.css';

function App() {
  const [currentView, setCurrentView] = useState('integrity'); // Default to Admin System Integrity

  return (
    <div className="app-container">
      {/* Platform Navigation Bar */}
      <nav style={navStyles.navbar}>
        <div style={navStyles.brandGroup}>
          <div style={navStyles.logoIcon}>🛡️</div>
          <div>
            <div style={navStyles.brandTitle}>Self-Healing Fraud Prevention Platform</div>
            <div style={navStyles.brandSubtitle}>Adaptive Authentication & System Integrity Framework</div>
          </div>
        </div>

        <div style={navStyles.navButtons}>
          <button
            style={currentView === 'integrity' ? navStyles.activeNavBtn : navStyles.navBtn}
            onClick={() => setCurrentView('integrity')}
          >
            🛡️ Admin System Integrity Dashboard
          </button>
          <button
            style={currentView === 'biometrics' ? navStyles.activeNavBtn : navStyles.navBtn}
            onClick={() => setCurrentView('biometrics')}
          >
            ⌨️ Behavioral Biometrics Studio
          </button>
        </div>
      </nav>

      {/* Main View Area */}
      {currentView === 'integrity' ? (
        <AdminIntegrityDashboard />
      ) : (
        <BehaviorAuthentication />
      )}
    </div>
  );
}

const navStyles = {
  navbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#090D16',
    borderBottom: '1px solid #1E293B',
    padding: '12px 24px'
  },
  brandGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  logoIcon: {
    fontSize: '22px'
  },
  brandTitle: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: '15px'
  },
  brandSubtitle: {
    color: '#64748B',
    fontSize: '11px'
  },
  navButtons: {
    display: 'flex',
    gap: '10px'
  },
  navBtn: {
    backgroundColor: '#1E293B',
    color: '#94A3B8',
    border: '1px solid #334155',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  activeNavBtn: {
    backgroundColor: '#3B82F6',
    color: '#FFFFFF',
    border: '1px solid #60A5FA',
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default App;
