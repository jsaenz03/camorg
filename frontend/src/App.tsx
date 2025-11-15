import { useState, useEffect } from 'react';
import { PatientListPage } from '@/pages/PatientListPage';
import { PatientDetailPage } from '@/pages/PatientDetailPage';
import { CameraTestPage } from '@/pages/CameraTestPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { CameraSetupWizard } from '@/components/photo/CameraSetupWizard';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Users, Camera, Settings } from 'lucide-react';

type CurrentPage = 'patients' | 'patient-detail' | 'camera' | 'settings';

const CAMERA_SETUP_KEY = 'camorg-camera-setup-complete';

function App() {
  const [currentPage, setCurrentPage] = useState<CurrentPage>('patients');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [showCameraWizard, setShowCameraWizard] = useState(false);

  useEffect(() => {
    // Check if camera setup has been completed
    const setupComplete = localStorage.getItem(CAMERA_SETUP_KEY);
    if (!setupComplete) {
      setShowCameraWizard(true);
    }
  }, []);

  const handleSetupComplete = () => {
    localStorage.setItem(CAMERA_SETUP_KEY, 'true');
    setShowCameraWizard(false);
  };

  const handlePatientSelect = (patientId: string) => {
    setSelectedPatientId(patientId);
    setCurrentPage('patient-detail');
  };

  const handleBackToPatients = () => {
    setSelectedPatientId(null);
    setCurrentPage('patients');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'patients':
        return <PatientListPage onPatientSelect={handlePatientSelect} />;
      case 'patient-detail':
        return selectedPatientId ? (
          <PatientDetailPage
            patientId={selectedPatientId}
            onBack={handleBackToPatients}
          />
        ) : (
          <PatientListPage onPatientSelect={handlePatientSelect} />
        );
      case 'camera':
        return <CameraTestPage onBack={() => setCurrentPage('patients')} />;
      case 'settings':
        return <SettingsPage onBack={() => setCurrentPage('patients')} />;
      default:
        return <PatientListPage onPatientSelect={handlePatientSelect} />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-foreground">
              cIQCam
            </h1>
            <nav className="flex gap-2">
              <Button
                variant={currentPage === 'patients' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentPage('patients')}
                className="flex items-center gap-2"
              >
                <Users className="h-4 w-4" />
                Patients
              </Button>
              <Button
                variant={currentPage === 'camera' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentPage('camera')}
                className="flex items-center gap-2"
              >
                <Camera className="h-4 w-4" />
                Camera Test
              </Button>
              <Button
                variant={currentPage === 'settings' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCurrentPage('settings')}
                className="flex items-center gap-2"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </nav>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        {renderPage()}
      </main>

      {/* Camera Setup Wizard */}
      <CameraSetupWizard
        open={showCameraWizard}
        onOpenChange={setShowCameraWizard}
        onSetupComplete={handleSetupComplete}
      />

      {/* Toast Notifications */}
      <Toaster />
    </div>
  );
}

export default App;