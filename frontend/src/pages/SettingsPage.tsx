import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Database, HardDrive, Info } from 'lucide-react';
import { SettingsService, type StorageType } from '@/services/settings-service';
import { useToast } from '@/hooks/use-toast';

interface SettingsPageProps {
  onBack: () => void;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [storageType, setStorageType] = useState<StorageType>('indexeddb');
  const [isFileSystemSupported, setIsFileSystemSupported] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Load current settings
    setStorageType(SettingsService.getStorageType());
    setIsFileSystemSupported(SettingsService.isFileSystemAccessSupported());
  }, []);

  const handleStorageTypeChange = (value: string) => {
    const newType = value as StorageType;
    setStorageType(newType);
    SettingsService.setStorageType(newType);

    toast({
      title: 'Storage Setting Updated',
      description: `Photo storage will now use ${newType === 'indexeddb' ? 'IndexedDB' : 'File System Access API'}`,
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      {/* Storage Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Photo Storage</CardTitle>
          <CardDescription>
            Choose how photos are stored in the application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup value={storageType} onValueChange={handleStorageTypeChange}>
            {/* IndexedDB Option */}
            <div className="flex items-start space-x-3 space-y-0 rounded-md border p-4">
              <RadioGroupItem value="indexeddb" id="indexeddb" />
              <div className="flex-1 space-y-1">
                <Label htmlFor="indexeddb" className="flex items-center gap-2 cursor-pointer">
                  <Database className="h-4 w-4" />
                  <span className="font-semibold">IndexedDB (Default)</span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  Store photos in the browser's IndexedDB database. Photos are stored internally
                  within the browser and are managed automatically. This is the most compatible
                  option and works on all modern browsers.
                </p>
                <div className="flex items-start gap-2 mt-2 text-xs text-muted-foreground">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>Best for ease of use and compatibility</span>
                </div>
              </div>
            </div>

            {/* File System Access API Option */}
            <div className="flex items-start space-x-3 space-y-0 rounded-md border p-4">
              <RadioGroupItem
                value="filesystem"
                id="filesystem"
                disabled={!isFileSystemSupported}
              />
              <div className="flex-1 space-y-1">
                <Label
                  htmlFor="filesystem"
                  className={`flex items-center gap-2 ${isFileSystemSupported ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                >
                  <HardDrive className="h-4 w-4" />
                  <span className="font-semibold">File System Access API</span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  Store photos directly on your local file system. You'll choose a folder where
                  photos will be saved, allowing you to access them outside the browser. Photos
                  are organized in a structured folder hierarchy.
                </p>
                <div className="flex items-start gap-2 mt-2 text-xs text-muted-foreground">
                  <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>Best for direct file access and external backup</span>
                </div>
                {!isFileSystemSupported && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertDescription>
                      File System Access API is not supported in your browser. Please use a
                      Chromium-based browser (Chrome, Edge, Opera) to use this feature.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </RadioGroup>

          {/* Additional Information */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <strong>Note:</strong> Changing the storage type will affect new photos only.
              Existing photos will remain in their current storage location. You may need to
              re-import or export photos if you switch storage types.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
