import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Camera, CheckCircle2, XCircle, AlertCircle, ChevronRight } from 'lucide-react';

interface CameraSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetupComplete?: () => void;
}

type SetupStep = 'intro' | 'permissions' | 'testing' | 'complete';

export function CameraSetupWizard({ open, onOpenChange, onSetupComplete }: CameraSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<SetupStep>('intro');
  const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null);
  const [_cameraWorking, setCameraWorking] = useState<boolean | null>(null);

  const requestCameraPermission = async () => {
    try {
      setCurrentStep('permissions');

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setPermissionGranted(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true
      });

      // Permission granted, stop the stream
      stream.getTracks().forEach(track => track.stop());
      setPermissionGranted(true);
      setCurrentStep('testing');
    } catch (err) {
      console.error('Camera permission error:', err);
      setPermissionGranted(false);
    }
  };

  const handleComplete = () => {
    onSetupComplete?.();
    onOpenChange(false);
    resetWizard();
  };

  const resetWizard = () => {
    setCurrentStep('intro');
    setPermissionGranted(null);
    setCameraWorking(null);
  };

  const handleSkip = () => {
    onOpenChange(false);
    resetWizard();
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 'intro':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Camera className="h-6 w-6" />
                Camera Setup Wizard
              </DialogTitle>
              <DialogDescription>
                Let's set up your camera for capturing dermatology photos.
                This will only take a moment.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">What you'll need:</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span>A device with a camera (webcam or phone)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span>Permission to access your camera</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span>Good lighting for clear photos</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="pt-4">
                  <div className="flex gap-2">
                    <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-900 mb-1">Privacy Notice</p>
                      <p className="text-amber-800">
                        All photos are stored locally on your device. No data is
                        sent to external servers.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleSkip}>
                Skip for Now
              </Button>
              <Button onClick={requestCameraPermission} className="flex items-center gap-2">
                Get Started
                <ChevronRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </>
        );

      case 'permissions':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Requesting Camera Access</DialogTitle>
              <DialogDescription>
                Your browser will ask for permission to use your camera.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6">
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center">
                    <div className="animate-pulse mb-4">
                      <Camera className="h-12 w-12 mx-auto text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Please allow camera access when prompted by your browser...
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {permissionGranted === false && (
              <DialogFooter>
                <Button variant="outline" onClick={handleSkip}>
                  Cancel
                </Button>
                <Button onClick={requestCameraPermission}>
                  Try Again
                </Button>
              </DialogFooter>
            )}
          </>
        );

      case 'testing':
        return (
          <>
            <DialogHeader>
              <DialogTitle>Camera Test Results</DialogTitle>
              <DialogDescription>
                Checking your camera setup...
              </DialogDescription>
            </DialogHeader>

            <div className="py-6 space-y-4">
              <Card className={permissionGranted ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    {permissionGranted ? (
                      <>
                        <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-green-900">Camera Permission Granted</p>
                          <p className="text-sm text-green-700">
                            Your browser has access to the camera
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-red-900">Permission Denied</p>
                          <p className="text-sm text-red-700">
                            Camera access was blocked or not available
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {!permissionGranted && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-600" />
                      Troubleshooting Tips
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-amber-900">
                    <p>• Check if your browser supports camera access</p>
                    <p>• Make sure no other app is using the camera</p>
                    <p>• Try refreshing the page and allowing permission</p>
                    <p>• Check browser settings for camera permissions</p>
                  </CardContent>
                </Card>
              )}
            </div>

            <DialogFooter>
              {permissionGranted ? (
                <Button onClick={() => setCurrentStep('complete')}>
                  Continue
                </Button>
              ) : (
                <>
                  <Button variant="outline" onClick={handleSkip}>
                    Skip
                  </Button>
                  <Button onClick={requestCameraPermission}>
                    Try Again
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        );

      case 'complete':
        return (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-600" />
                Setup Complete!
              </DialogTitle>
              <DialogDescription>
                Your camera is ready to capture dermatology photos.
              </DialogDescription>
            </DialogHeader>

            <div className="py-6">
              <Card className="border-green-200 bg-green-50">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-green-900">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Camera access enabled</span>
                    </div>
                    <div className="flex items-center gap-2 text-green-900">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Ready to capture photos</span>
                    </div>
                    <div className="flex items-center gap-2 text-green-900">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                      <span className="font-medium">Local storage configured</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-4">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Next Steps:</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>1. Navigate to the Camera Test page to try capturing a photo</p>
                  <p>2. Create a patient record to organize photos</p>
                  <p>3. Start documenting dermatology cases</p>
                </CardContent>
              </Card>
            </div>

            <DialogFooter>
              <Button onClick={handleComplete} className="w-full">
                Start Using Camera
              </Button>
            </DialogFooter>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        {renderStepContent()}
      </DialogContent>
    </Dialog>
  );
}