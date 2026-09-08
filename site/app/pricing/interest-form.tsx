/**
 * The interest field moved into the shared components with the rest of the system, so the
 * same field can stand on the pricing page and at the foot of the account. This file keeps
 * its name and its export so nothing that imports it has to move; the server action it
 * calls is unchanged.
 */
export { InterestField, InterestField as InterestForm } from "../../components/interest-field";
