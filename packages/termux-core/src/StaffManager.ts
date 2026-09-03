import { BrainStaff } from "./BrainStaff"
import { FireStaff } from "./FireStaff"
import { HireStaff } from "./HireStaff"

export class StaffManager {
  readonly brain: BrainStaff
  readonly hire: HireStaff
  readonly fire: FireStaff

  constructor() {
    this.brain = new BrainStaff()
    this.hire = new HireStaff()
    this.fire = new FireStaff(this.hire)
  }
}
