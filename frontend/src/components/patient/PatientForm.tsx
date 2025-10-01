import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PatientService } from '@/services/patient-service';
import { Patient } from '@/models/patient';
import { Loader2 } from 'lucide-react';

interface PatientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPatientCreated?: (patient: Patient) => void;
}

export function PatientForm({ open, onOpenChange, onPatientCreated }: PatientFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patientService = new PatientService();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);

    const name = formData.get('name') as string;
    const dateOfBirth = formData.get('dateOfBirth') as string;
    const assignedDoctor = formData.get('assignedDoctor') as string;
    const notes = formData.get('notes') as string;
    const isUrgent = formData.get('isUrgent') === 'on';

    // Validation
    if (!name || !dateOfBirth || !assignedDoctor) {
      setError('Please fill in all required fields');
      setIsSubmitting(false);
      return;
    }

    try {
      const newPatient = await patientService.createPatient({
        name: name.trim(),
        dateOfBirth: new Date(dateOfBirth),
        assignedDoctor: assignedDoctor.trim(),
        isUrgent,
        notes: notes?.trim() || undefined,
      });

      onPatientCreated?.(newPatient);
      onOpenChange(false);

      // Reset form
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      console.error('Error creating patient:', err);
      setError('Failed to create patient. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Patient</DialogTitle>
          <DialogDescription>
            Create a new patient record. All fields marked with * are required.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Patient Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                placeholder="John Doe"
                required
                disabled={isSubmitting}
              />
            </div>

            {/* Date of Birth */}
            <div className="space-y-2">
              <Label htmlFor="dateOfBirth">
                Date of Birth <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dateOfBirth"
                name="dateOfBirth"
                type="date"
                required
                disabled={isSubmitting}
                max={new Date().toISOString().split('T')[0]}
              />
            </div>

            {/* Assigned Doctor */}
            <div className="space-y-2">
              <Label htmlFor="assignedDoctor">
                Assigned Doctor <span className="text-destructive">*</span>
              </Label>
              <Input
                id="assignedDoctor"
                name="assignedDoctor"
                placeholder="Dr. Smith"
                required
                disabled={isSubmitting}
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                name="notes"
                placeholder="Additional notes or observations..."
                disabled={isSubmitting}
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {/* Urgent Flag */}
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="isUrgent"
                name="isUrgent"
                disabled={isSubmitting}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label
                htmlFor="isUrgent"
                className="text-sm font-normal cursor-pointer"
              >
                Mark as urgent case
              </Label>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Create Patient
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}