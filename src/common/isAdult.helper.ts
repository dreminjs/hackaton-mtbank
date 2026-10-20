import { UserRole } from '#generated/prisma';

export const calculateAge = (birthDate: Date): number => {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  return age;
};

export const isAdult = (birthDate: Date): boolean => {
  return calculateAge(birthDate) >= 18;
};

/**
 * Определение роли ребенка по дате рождения:
 * 7 - 13 -> CHILD_7_13
 * 14 - 17 -> TEEN_14_17
 * 18+ -> ORDINARY (или взрослый)
 */
export const resolveChildRole = (birthDate: Date): UserRole => {
  const age = calculateAge(birthDate);

  if (age >= 14 && age <= 17) {
    return UserRole.TEEN_14_17;
  }
  if (age >= 7 && age <= 13) {
    return UserRole.CHILD_7_13;
  }
  return UserRole.ORDINARY;
};
