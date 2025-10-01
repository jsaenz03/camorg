import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PatientForm } from '@/components/patient/PatientForm';
import { PatientService } from '@/services/patient-service';
import { Patient } from '@/models/patient';
import { Plus, Search, User, Calendar } from 'lucide-react';

interface PatientListPageProps {
  onPatientSelect?: (patientId: string) => void;
}

export function PatientListPage({ onPatientSelect }: PatientListPageProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPatientForm, setShowPatientForm] = useState(false);

  const patientService = new PatientService();

  useEffect(() => {
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      setLoading(true);
      setError(null);
      const patientList = await patientService.getPatients();
      setPatients(patientList);
    } catch (err) {
      setError('Failed to load patients');
      console.error('Error loading patients:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredPatients = patients.filter(patient =>
    patient.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    patient.assignedDoctor.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  const handlePatientCreated = (newPatient: Patient) => {
    setPatients([newPatient, ...patients]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading patients...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patients</h1>
          <p className="text-muted-foreground">
            Manage patient records and photo organization
          </p>
        </div>
        <Button className="flex items-center gap-2" onClick={() => setShowPatientForm(true)}>
          <Plus className="h-4 w-4" />
          Add Patient
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search patients or doctors..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Error State */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <p>{error}</p>
              <Button variant="outline" size="sm" onClick={loadPatients}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Patients List */}
      {filteredPatients.length === 0 && !loading && !error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <User className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No patients found</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm
                  ? `No patients match "${searchTerm}"`
                  : 'Get started by adding your first patient'
                }
              </p>
              {!searchTerm && (
                <Button onClick={() => setShowPatientForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Patient
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredPatients.map((patient) => (
            <Card
              key={patient.id}
              className="hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => onPatientSelect?.(patient.id)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{patient.name}</CardTitle>
                      <CardDescription>
                        Dr. {patient.assignedDoctor}
                      </CardDescription>
                    </div>
                  </div>
                  {patient.isUrgent && (
                    <div className="h-3 w-3 rounded-full bg-red-500" />
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Born: {formatDate(patient.dateOfBirth)}
                  </div>
                  {patient.followUpDate && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      Follow-up: {formatDate(patient.followUpDate)}
                    </div>
                  )}
                  {patient.notes && (
                    <p className="text-sm text-muted-foreground truncate">
                      {patient.notes}
                    </p>
                  )}
                </div>
                <div className="mt-4 pt-3 border-t flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">
                    Added {formatDate(patient.createdAt)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPatientSelect?.(patient.id);
                    }}
                  >
                    View Photos
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Stats Footer */}
      {patients.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>
                Showing {filteredPatients.length} of {patients.length} patients
              </span>
              <span>
                {patients.filter(p => p.isUrgent).length} urgent cases
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Patient Form Dialog */}
      <PatientForm
        open={showPatientForm}
        onOpenChange={setShowPatientForm}
        onPatientCreated={handlePatientCreated}
      />
    </div>
  );
}