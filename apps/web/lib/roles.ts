/** Which home layout a person gets, from their highest role in this unit. */
export type Level = 'chief' | 'faculty' | 'resident' | 'intern' | 'nurse' | 'admin';
export function levelOf(roles: string[]): Level {
  if (roles.includes('unit_chief')) return 'chief';
  if (roles.includes('faculty')) return 'faculty';
  if (roles.includes('senior_resident') || roles.includes('postgraduate')) return 'resident';
  if (roles.includes('intern')) return 'intern';
  if (roles.includes('staff_nurse') || roles.includes('data_entry')) return 'nurse';
  return 'admin';
}

