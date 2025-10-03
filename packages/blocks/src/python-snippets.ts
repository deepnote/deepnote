import dedent from 'ts-dedent'

import { escapePythonString, sanitizePythonVariableName } from './blocks/python-utils'

export const pythonCode = {
  setVariableContextValue: (variableName: string, value: boolean) => {
    const sanitizedPythonVariableName = sanitizePythonVariableName(variableName)
    return `${sanitizedPythonVariableName} = ${value ? 'True' : 'False'}`
  },

  executeBigNumber: (
    titleTemplate: string,
    valueVariableName: string,
    comparisonTitleTemplate = '',
    comparisonVariableName = ''
  ) => {
    const valuePart = valueVariableName ? `f"{${valueVariableName}}"` : `""`
    const comparisonValuePart = comparisonVariableName ? `f"{${comparisonVariableName}}"` : `""`

    return `
def __deepnote_big_number__():
    import json
    import jinja2
    from jinja2 import meta

    def render_template(template):
        parsed_content = jinja2.Environment().parse(template)

        required_variables = meta.find_undeclared_variables(parsed_content)

        context = {
            variable_name: globals().get(variable_name)
            for variable_name in required_variables
        }

        result = jinja2.Environment().from_string(template).render(context)

        return result

    rendered_title = render_template(${escapePythonString(titleTemplate)})
    rendered_comparison_title = render_template(${escapePythonString(comparisonTitleTemplate)})

    return json.dumps({
        "comparisonTitle": rendered_comparison_title,
        "comparisonValue": ${comparisonValuePart},
        "title": rendered_title,
        "value": ${valuePart}
    })

__deepnote_big_number__()
`
  },

  executeVisualization: (variableName: string, spec: string, filters: string) => {
    return dedent`
      _dntk.DeepnoteChart(${variableName}, """${spec}""", attach_selection=True, filters=${escapePythonString(filters)})
    `
  },

  // Date range helpers - names are sanitized to ensure valid Python identifiers
  dateRangePast7days: (name: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
      ${sanitizedName} = [_deepnote_datetime.now().date() - _deepnote_timedelta(days=7), _deepnote_datetime.now().date()]
    `
  },

  dateRangePast14days: (name: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime as _deepnote_datetime, timedelta as _deepnote_timedelta
      ${sanitizedName} = [_deepnote_datetime.now().date() - _deepnote_timedelta(days=14), _deepnote_datetime.now().date()]
    `
  },

  dateRangePastMonth: (name: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime as _deepnote_datetime
      from dateutil.relativedelta import relativedelta
      ${sanitizedName} = [_deepnote_datetime.now().date() - relativedelta(months=1), _deepnote_datetime.now().date()]
    `
  },

  dateRangePast3months: (name: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime as _deepnote_datetime
      from dateutil.relativedelta import relativedelta
      ${sanitizedName} = [_deepnote_datetime.now().date() - relativedelta(months=3), _deepnote_datetime.now().date()]
    `
  },

  dateRangePast6months: (name: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime as _deepnote_datetime
      from dateutil.relativedelta import relativedelta
      ${sanitizedName} = [_deepnote_datetime.now().date() - relativedelta(months=6), _deepnote_datetime.now().date()]
    `
  },

  dateRangePastYear: (name: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime as _deepnote_datetime
      from dateutil.relativedelta import relativedelta
      ${sanitizedName} = [_deepnote_datetime.now().date() - relativedelta(years=1), _deepnote_datetime.now().date()]
    `
  },

  dateRangeCustomDays: (name: string, days: number) => {
    const sanitizedName = sanitizePythonVariableName(name)
    return dedent`
      from datetime import datetime, timedelta
      ${sanitizedName} = [datetime.now().date() - timedelta(days=${days}), datetime.now().date()]
    `
  },

  dateRangeAbsolute: (name: string, startDate: string, endDate: string) => {
    const sanitizedName = sanitizePythonVariableName(name)
    const escapedStartDate = escapePythonString(startDate)
    const escapedEndDate = escapePythonString(endDate)
    return dedent`
      from dateutil.parser import parse as _deepnote_parse
      ${sanitizedName} = [${startDate ? `_deepnote_parse(${escapedStartDate}).date()` : 'None'}, ${endDate ? `_deepnote_parse(${escapedEndDate}).date()` : 'None'}]
    `
  },
}
