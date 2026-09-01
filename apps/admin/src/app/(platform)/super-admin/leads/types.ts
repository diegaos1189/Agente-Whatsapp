export type LeadStatus = "NEW" | "CONTACTED" | "CLOSED";

export type Lead = {
  id: string;
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  message: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
};
