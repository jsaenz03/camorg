import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon, User, Loader2 } from 'lucide-react';
import { PatientService } from '@/services/patient-service';
import type { Patient } from '@/models/patient';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface PatientEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient | null;
  onPatientUpdated: (updatedPatient: Patient) => void;
}

export function PatientEditDialog({
  open,
  onOpenChange,
  patient,
  onPatientUpdated,
}: PatientEditDialogProps) {
  const [formData, setFormData] = useState({
    name: '',
    dateOfBirth: new Date(),
    assignedDoctor: '',
    notes: '',
    isUrgent: false,
    followUpDate: undefined as Date | undefined,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patientService = new PatientService();

  // Reset form when patient changes
  useEffect(() => {
    if (patient) {
      setFormData({
        name: patient.name,
        dateOfBirth: patient.dateOfBirth,
        assignedDoctor: patient.assignedDoctor,
        notes: patient.notes || '',
        isUrgent: patient.isUrgent,
        followUpDate: patient.followUpDate || undefined,
      });
      setError(null);
    }
  }, [patient]);

  const handleInputChange = (field: string, value: string | boolean | Date | undefined) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
    setError(null);
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];

    if (!formData.name.trim()) {
      errors.push('Patient name is required');
    }

    if (!formData.assignedDoctor.trim()) {
      errors.push('Assigned doctor is required');
    }

    if (!formData.dateOfBirth) {
      errors.push('Date of birth is required');
    } else {
      const today = new Date();
      const dob = new Date(formData.dateOfBirth);
      if (dob > today) {
        errors.push('Date of birth cannot be in the future');
      }
      const age = today.getFullYear() - dob.getFullYear();
      if (age > 150) {
        errors.push('Invalid date of birth');
      }
    }

    if (formData.followUpDate && formData.followUpDate <= new Date()) {
      errors.push('Follow-up date must be in the future');
    }

    return errors;
  };

  const handleSubmit = async () => {
    if (!patient) return;

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join('. '));
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const updateRequest = {
        name: formData.name.trim(),
        dateOfBirth: formData.dateOfBirth,
        assignedDoctor: formData.assignedDoctor.trim(),
        notes: formData.notes.trim() || undefined,
        isUrgent: formData.isUrgent,
        followUpDate: formData.followUpDate,
      };

      const updatedPatient = await patientService.updatePatient(patient.id, updateRequest);
      onPatientUpdated(updatedPatient);
      onOpenChange(false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update patient';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date: Date) => {
    return format(date, 'MMM d, yyyy');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Edit Patient Information
          </DialogTitle>
          <DialogDescription>
            Update the patient's personal and medical information
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Basic Information</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="patient-name">Patient Name *</Label>
                <Input
                  id="patient-name"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  placeholder="Enter patient name"
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="assigned-doctor">Assigned Doctor *</Label>
                <Input
                  id="assigned-doctor"
                  value={formData.assignedDoctor}
                  onChange={(e) => handleInputChange('assignedDoctor', e.target.value)}
                  placeholder="Dr. Smith"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Date of Birth *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !formData.dateOfBirth && 'text-muted-foreground'
                    )}
                    disabled={isLoading}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.dateOfBirth ? formatDate(formData.dateOfBirth) : 'Select date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.dateOfBirth}
                    onSelect={(date) => date && handleInputChange('dateOfBirth', date)}
                    initialFocus
                    disabled={(date) => date > new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="Additional notes about the patient"
                rows={3}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Medical Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Medical Information</h3>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="urgent"
                  checked={formData.isUrgent}
                  onCheckedChange={(checked) => handleInputChange('isUrgent', checked as boolean)}
                  disabled={isLoading}
                />
                <Label htmlFor="urgent" className="text-sm font-medium">
                  Mark as urgent case
                </Label>
              </div>
              <p className="text-xs text-muted-foreground ml-6">
                Urgent cases require immediate attention and will be highlighted throughout the system
              </p>
            </div>

            <div className="space-y-2">
              <Label>Follow-up Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal',
                      !formData.followUpDate && 'text-muted-foreground'
                    )}
                    disabled={isLoading}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formData.followUpDate ? formatDate(formData.followUpDate) : 'Select follow-up date (optional)'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={formData.followUpDate}
                    onSelect={(date) => date && handleInputChange('followUpDate', date)}
                    initialFocus
                    disabled={(date) => date <= new Date()}
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Schedule a follow-up appointment if needed
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <User className="h-4 w-4" />
                Update Patient
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}