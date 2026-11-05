/**
 * A change to a library option that resolves the condition a message reports. `option` names a property
 * of the options object of the call that reported it, and `value` is what to set it to. Callers translate
 * it into their own surface, such as a command line or a tool schema.
 */
export type OptionHint = { option: 'syncRoot'; value: false } | { option: 'prune'; value: true }
