import { factoryWeightSlip } from '@/modules/profiles/factory-weight-slip';
import { profileProblems } from '../../helpers/profile-contract';

describe('profiles/factory-weight-slip', () => {
  it('meets the profile contract', () => {
    expect(profileProblems(factoryWeightSlip)).toEqual([]);
  });
});
