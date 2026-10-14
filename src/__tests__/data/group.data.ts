/**
 * This template represents a homogeneous group, a collection of members who share
 * a common type, such as employees in a department or members of a family.
 *
 * This template represents a group's core data model. The claims are a flattened
 * representation based on the FHIR Group resource's search parameters. It's
 * designed to represent a homogeneous collection of entities.
 */
export const TestGroupTemplateClaims = {
    '@context': 'json', // Your internal data context.
    '@type': 'Group', // The FHIR resource type this data maps to.
    claims: {
        // Defines the type of entities in the group (e.g., 'person', 'organization', 'device').
        'type': 'person | organization | device',
        // Whether the group is currently active. Aligns with Group.active.
        'active': true,
        // The membership status of the group. Aligns with Group.membership.
        'membership': 'enumerated',
        // Contact details for the individuals responsible for this group.
        'contact-email': '<comma-separated list of emails for the controllers>',
        // A code to categorize the group members based on their role or purpose.
        'code': '<Kind of Group members>',
        // The date of the last change to the group. Aligns with Group.date.
        'date': '<iso-datetime>',
        // A descriptive name for the group (e.g., "Customer Service Team", "Project A").
        'title': '<Descriptive name for this group of members>',
        // The entity or organization managing this group. Aligns with Group.managingEntity.
        'managing-entity': '<URN or did:web:...>',
    }
}

/**
 * This template represents a connection channel or a collection of related groups linked to a central subject. It uses the structure of the List resource to link and manage these diverse collections.
 *
 * This template represents a connection channel or a list of linked groups.
 * The claims are based on the FHIR List resource's search parameters. It's
 * used to link various related groups to a central subject. The 'membership'
 * claim has been removed to align with your specific requirements.
 */
export const TestListTemplateClaims = {
    '@context': 'json',
    '@type': 'List',
    claims: {
        // The central entity this list is about (e.g., a customer, a project). Aligns with List.subject.
        'subject': '<URN for the client>',
        // Whether the list is currently in use. Aligns with List.status.
        'active': true,
        // Contact details for the controllers who can approve changes to this list.
        'contact-email': '<comma-separated list of emails for the controllers>',
        // A code to categorize the type of connection channel.
        'code': '<Kind of Group members>',
        // The date of the last change to this list. Aligns with List.date.
        'date': '<iso-datetime>',
        // A descriptive name for the connection channel (e.g., "Project A Team", "Client B Subscription").
        'title': '<Descriptive name for this group of members>',
        // The individual or entity who proposed this list for creation. Aligns with List.source.
        'source': '<practitioner URN or email>',
    }
}

/**
 * This template represents a single member's details, designed for tracking a person or an entity within a group in a generic way.
 *
 * This template represents a single member's data. It is a simplified, flattened
 * representation combining elements from FHIR Group.member and List.entry.
 */
export const TestGroupMemberTemplateClaims = {
    '@context': 'json',
    '@type': 'Member',
    claims: {
        // The URN or email identifying the member. Aligns with Group.member.entity and List.entry.item.
        'entity': '<URN or email>',
        // The date the member was added or changed. Aligns with List.entry.date.
        'date': '<iso-datetime>',
        // The date the member's membership ended. Aligns with Group.member.period.end.
        'end': '<iso-datetime>',
        // A boolean flag indicating if the member has been removed. Aligns with List.entry.deleted.
        'deleted': false,
    }
}

/**
 * This template represents a historical list of members, which can be used to
 * reconstruct a group's current and past states. The structure is based on the
 * FHIR List resource.
 *
 * This template represents a historical list of members, which can be used to
 * reconstruct a group's current and past states. The structure is based on the
 * FHIR List resource.
 */
export const TestListGroupMembers = {
    '@context': 'json',
    '@type': 'List',
    // The core element holding all member entries. Aligns with List.entry.
    entry: [{
        // The member's identifier. Aligns with List.entry.item.
        'entity': '<URN or email>',
        // The date of the entry.
        'date': '<iso-datetime>',
        // The end date of membership. Optional for tracking history.
        'end': '<iso-datetime>',
        // A flag indicating if this member was removed. Aligns with List.entry.deleted.
        'deleted': false,
    }]
}



