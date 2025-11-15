import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronRight } from 'lucide-react';
import type { BodyPartCategory } from '@/models/body-part';

interface HierarchicalBodyPartSelectorProps {
  bodyParts: BodyPartCategory[];
  value: string;
  onChange: (value: string) => void;
  patientId: string;
}

export function HierarchicalBodyPartSelector({
  bodyParts,
  value,
  onChange,
}: HierarchicalBodyPartSelectorProps) {
  const [level0Parts, setLevel0Parts] = useState<BodyPartCategory[]>([]);
  const [level1Parts, setLevel1Parts] = useState<BodyPartCategory[]>([]);
  const [level2Parts, setLevel2Parts] = useState<BodyPartCategory[]>([]);

  const [selectedLevel0, setSelectedLevel0] = useState<string>('');
  const [selectedLevel1, setSelectedLevel1] = useState<string>('');
  const [selectedLevel2, setSelectedLevel2] = useState<string>('');

  // Organize body parts by level
  useEffect(() => {
    const l0 = bodyParts.filter(bp => bp.level === 0).sort((a, b) => a.displayOrder - b.displayOrder);
    setLevel0Parts(l0);
  }, [bodyParts]);

  // Update level 1 parts when level 0 changes
  useEffect(() => {
    if (selectedLevel0) {
      const l1 = bodyParts
        .filter(bp => bp.parentId === selectedLevel0 && bp.level === 1)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      setLevel1Parts(l1);
    } else {
      setLevel1Parts([]);
      setLevel2Parts([]);
    }
  }, [selectedLevel0, bodyParts]);

  // Update level 2 parts when level 1 changes
  useEffect(() => {
    if (selectedLevel1) {
      const l2 = bodyParts
        .filter(bp => bp.parentId === selectedLevel1 && bp.level === 2)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      setLevel2Parts(l2);
    } else {
      setLevel2Parts([]);
    }
  }, [selectedLevel1, bodyParts]);

  // Handle level 0 selection
  const handleLevel0Change = (partId: string) => {
    setSelectedLevel0(partId);
    setSelectedLevel1('');
    setSelectedLevel2('');

    // Always allow selection at this level
    onChange(partId);
  };

  // Handle level 1 selection
  const handleLevel1Change = (partId: string) => {
    setSelectedLevel1(partId);
    setSelectedLevel2('');

    // Always allow selection at this level
    onChange(partId);
  };

  // Handle level 2 selection
  const handleLevel2Change = (partId: string) => {
    setSelectedLevel2(partId);
    onChange(partId);
  };

  // Get display path
  const getSelectedPath = () => {
    const parts: string[] = [];
    if (selectedLevel0) {
      const l0 = bodyParts.find(bp => bp.id === selectedLevel0);
      if (l0) parts.push(l0.name);
    }
    if (selectedLevel1) {
      const l1 = bodyParts.find(bp => bp.id === selectedLevel1);
      if (l1) parts.push(l1.name);
    }
    if (selectedLevel2) {
      const l2 = bodyParts.find(bp => bp.id === selectedLevel2);
      if (l2) parts.push(l2.name);
    }
    return parts.join(' → ');
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="body-part-level-0" className="flex items-center gap-2">
          <span className="text-base font-semibold">Step 1: Select Body Region *</span>
        </Label>
        <Select value={selectedLevel0} onValueChange={handleLevel0Change}>
          <SelectTrigger id="body-part-level-0" className="w-full">
            <SelectValue placeholder="Select major body region..." />
          </SelectTrigger>
          <SelectContent>
            {level0Parts.map((bodyPart) => (
              <SelectItem key={bodyPart.id} value={bodyPart.id}>
                {bodyPart.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {level1Parts.length > 0 && (
        <div className="space-y-2 pl-4 border-l-2 border-primary/20">
          <Label htmlFor="body-part-level-1" className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            <span className="text-base font-semibold">Step 2: Select Specific Area *</span>
          </Label>
          <Select value={selectedLevel1} onValueChange={handleLevel1Change}>
            <SelectTrigger id="body-part-level-1" className="w-full">
              <SelectValue placeholder="Select specific area..." />
            </SelectTrigger>
            <SelectContent>
              {level1Parts.map((bodyPart) => (
                <SelectItem key={bodyPart.id} value={bodyPart.id}>
                  {bodyPart.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {level2Parts.length > 0 && (
        <div className="space-y-2 pl-8 border-l-2 border-primary/20">
          <Label htmlFor="body-part-level-2" className="flex items-center gap-2">
            <ChevronRight className="h-4 w-4" />
            <span className="text-base font-semibold">Step 3: Select Precise Location</span>
          </Label>
          <Select value={selectedLevel2} onValueChange={handleLevel2Change}>
            <SelectTrigger id="body-part-level-2" className="w-full">
              <SelectValue placeholder="Select precise location..." />
            </SelectTrigger>
            <SelectContent>
              {level2Parts.map((bodyPart) => (
                <SelectItem key={bodyPart.id} value={bodyPart.id}>
                  {bodyPart.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {value && getSelectedPath() && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
          <div className="text-sm font-medium text-primary">Selected Location:</div>
          <div className="text-sm text-foreground mt-1">{getSelectedPath()}</div>
        </div>
      )}
    </div>
  );
}
