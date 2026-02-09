/**
 * Template definitions for different notebook types.
 * Used by the deepnote_template magic tool to create pre-built notebook structures.
 */
export interface TemplateBlock {
  type: string
  content: string
  metadata?: Record<string, unknown>
}

export const templates: Record<string, TemplateBlock[]> = {
  dashboard: [
    { type: 'text-cell-h1', content: 'Dashboard' },
    { type: 'markdown', content: 'Interactive dashboard with filters and KPIs.' },
    { type: 'text-cell-h2', content: 'Configuration' },
    {
      type: 'input-date-range',
      content: '',
      metadata: {
        deepnote_variable_name: 'date_range',
        deepnote_input_label: 'Date Range',
        deepnote_input_presets: ['Last 7 days', 'Last 30 days', 'Last 90 days', 'Year to date'],
        deepnote_variable_value: 'past7days',
      },
    },
    {
      type: 'input-select',
      content: '',
      metadata: {
        deepnote_variable_name: 'category',
        deepnote_input_label: 'Category',
        deepnote_input_options: ['All', 'Category A', 'Category B', 'Category C'],
        deepnote_input_default: 'All',
        deepnote_variable_value: 'All',
      },
    },
    { type: 'text-cell-h2', content: 'Key Metrics' },
    {
      type: 'code',
      content: `import pandas as pd
import numpy as np

# Load and filter data based on inputs
# df = pd.read_csv('data.csv')
# df_filtered = df[(df['date'] >= date_range[0]) & (df['date'] <= date_range[1])]
# if category != 'All':
#     df_filtered = df_filtered[df_filtered['category'] == category]

# Calculate KPIs
total_revenue = 125000  # Replace with actual calculation
total_orders = 450
avg_order_value = total_revenue / total_orders if total_orders > 0 else 0`,
    },
    {
      type: 'big-number',
      content: '',
      metadata: {
        deepnote_variable_name: 'total_revenue',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Deepnote template format
        deepnote_big_number_template: '${value:,.0f}',
        deepnote_big_number_label: 'Total Revenue',
      },
    },
    {
      type: 'big-number',
      content: '',
      metadata: {
        deepnote_variable_name: 'total_orders',
        deepnote_big_number_template: '{value}',
        deepnote_big_number_label: 'Total Orders',
      },
    },
    { type: 'text-cell-h2', content: 'Visualizations' },
    {
      type: 'code',
      content: `import matplotlib.pyplot as plt
import seaborn as sns

# Create visualizations
fig, axes = plt.subplots(1, 2, figsize=(14, 5))

# Chart 1: Revenue over time
# axes[0].plot(df_filtered.groupby('date')['revenue'].sum())
axes[0].set_title('Revenue Over Time')
axes[0].set_xlabel('Date')
axes[0].set_ylabel('Revenue')

# Chart 2: Category breakdown
# df_filtered.groupby('category')['revenue'].sum().plot(kind='bar', ax=axes[1])
axes[1].set_title('Revenue by Category')

plt.tight_layout()
plt.show()`,
    },
  ],
  ml_pipeline: [
    { type: 'text-cell-h1', content: 'ML Pipeline' },
    {
      type: 'markdown',
      content: 'Machine learning pipeline with data loading, preprocessing, training, and evaluation.',
    },
    { type: 'text-cell-h2', content: 'Configuration' },
    {
      type: 'input-text',
      content: '',
      metadata: {
        deepnote_variable_name: 'data_path',
        deepnote_input_label: 'Data File Path',
        deepnote_input_default: 'data.csv',
        deepnote_variable_value: 'data.csv',
      },
    },
    {
      type: 'input-slider',
      content: '',
      metadata: {
        deepnote_variable_name: 'test_size',
        deepnote_input_label: 'Test Set Size',
        deepnote_input_min: 0.1,
        deepnote_input_max: 0.4,
        deepnote_input_step: 0.05,
        deepnote_input_default: 0.2,
        deepnote_variable_value: '0.2',
      },
    },
    {
      type: 'input-slider',
      content: '',
      metadata: {
        deepnote_variable_name: 'random_state',
        deepnote_input_label: 'Random State',
        deepnote_input_min: 0,
        deepnote_input_max: 100,
        deepnote_input_step: 1,
        deepnote_input_default: 42,
        deepnote_variable_value: '42',
      },
    },
    { type: 'text-cell-h2', content: 'Data Loading' },
    {
      type: 'code',
      content: `import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Load data
df = pd.read_csv(data_path)
print(f"Loaded {len(df)} rows, {len(df.columns)} columns")
df.head()`,
    },
    { type: 'text-cell-h2', content: 'Data Preprocessing' },
    {
      type: 'code',
      content: `# Define features and target
# X = df.drop('target', axis=1)
# y = df['target']

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=test_size, random_state=random_state
)

# Scale features
scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

print(f"Training: {len(X_train)} samples")
print(f"Testing: {len(X_test)} samples")`,
    },
    { type: 'text-cell-h2', content: 'Model Training' },
    {
      type: 'code',
      content: `from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

# Train model
model = RandomForestClassifier(n_estimators=100, random_state=random_state)
model.fit(X_train_scaled, y_train)

# Training score
train_score = model.score(X_train_scaled, y_train)
print(f"Training accuracy: {train_score:.4f}")`,
    },
    { type: 'text-cell-h2', content: 'Model Evaluation' },
    {
      type: 'code',
      content: `from sklearn.metrics import classification_report, confusion_matrix
import seaborn as sns
import matplotlib.pyplot as plt

# Predictions
y_pred = model.predict(X_test_scaled)
test_score = model.score(X_test_scaled, y_test)

print(f"Test accuracy: {test_score:.4f}")
print("\\n" + classification_report(y_test, y_pred))

# Confusion matrix
plt.figure(figsize=(8, 6))
cm = confusion_matrix(y_test, y_pred)
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues')
plt.xlabel('Predicted')
plt.ylabel('Actual')
plt.title('Confusion Matrix')
plt.show()`,
    },
  ],
  etl: [
    { type: 'text-cell-h1', content: 'ETL Pipeline' },
    { type: 'markdown', content: 'Extract-Transform-Load pipeline with validation and error handling.' },
    { type: 'text-cell-h2', content: 'Configuration' },
    {
      type: 'input-text',
      content: '',
      metadata: {
        deepnote_variable_name: 'source_path',
        deepnote_input_label: 'Source File/URL',
        deepnote_input_default: 'input_data.csv',
        deepnote_variable_value: 'input_data.csv',
      },
    },
    {
      type: 'input-text',
      content: '',
      metadata: {
        deepnote_variable_name: 'output_path',
        deepnote_input_label: 'Output File',
        deepnote_input_default: 'output_data.csv',
        deepnote_variable_value: 'output_data.csv',
      },
    },
    {
      type: 'input-checkbox',
      content: '',
      metadata: {
        deepnote_variable_name: 'validate_output',
        deepnote_input_label: 'Validate Output',
        deepnote_input_default: true,
        deepnote_variable_value: true,
      },
    },
    { type: 'text-cell-h2', content: 'Extract' },
    {
      type: 'code',
      content: `import pandas as pd
from datetime import datetime

print(f"[{datetime.now()}] Starting extraction...")

# Extract data from source
try:
    df_raw = pd.read_csv(source_path)
    print(f"✓ Extracted {len(df_raw)} rows from {source_path}")
except Exception as e:
    print(f"✗ Extraction failed: {e}")
    raise

df_raw.head()`,
    },
    { type: 'text-cell-h2', content: 'Transform' },
    {
      type: 'code',
      content: `print(f"[{datetime.now()}] Starting transformation...")

def transform_data(df):
    """Apply transformations to the data."""
    df_transformed = df.copy()
    
    # Remove duplicates
    initial_rows = len(df_transformed)
    df_transformed = df_transformed.drop_duplicates()
    print(f"  - Removed {initial_rows - len(df_transformed)} duplicates")
    
    # Handle missing values
    missing_before = df_transformed.isnull().sum().sum()
    df_transformed = df_transformed.fillna(method='ffill').fillna(method='bfill')
    print(f"  - Handled {missing_before} missing values")
    
    # Add transformations here
    # df_transformed['new_col'] = df_transformed['col'].apply(func)
    
    return df_transformed

df_transformed = transform_data(df_raw)
print(f"✓ Transformed {len(df_transformed)} rows")`,
    },
    { type: 'text-cell-h2', content: 'Validate' },
    {
      type: 'code',
      content: `print(f"[{datetime.now()}] Validating...")

def validate_data(df):
    """Validate the transformed data."""
    issues = []
    
    # Check for nulls
    null_counts = df.isnull().sum()
    if null_counts.any():
        issues.append(f"Found null values: {null_counts[null_counts > 0].to_dict()}")
    
    # Check for duplicates
    if df.duplicated().any():
        issues.append(f"Found {df.duplicated().sum()} duplicate rows")
    
    # Add custom validations
    # if df['column'].min() < 0:
    #     issues.append("Negative values found in column")
    
    return issues

if validate_output:
    issues = validate_data(df_transformed)
    if issues:
        print("✗ Validation issues found:")
        for issue in issues:
            print(f"  - {issue}")
    else:
        print("✓ Validation passed")`,
    },
    { type: 'text-cell-h2', content: 'Load' },
    {
      type: 'code',
      content: `print(f"[{datetime.now()}] Loading to destination...")

# Save to output
try:
    df_transformed.to_csv(output_path, index=False)
    print(f"✓ Saved {len(df_transformed)} rows to {output_path}")
except Exception as e:
    print(f"✗ Load failed: {e}")
    raise

print(f"[{datetime.now()}] ETL pipeline complete!")`,
    },
  ],
  report: [
    { type: 'text-cell-h1', content: 'Analysis Report' },
    {
      type: 'markdown',
      content: `## Executive Summary

This report presents the analysis of [describe data source]. Key findings include:
- Finding 1
- Finding 2
- Finding 3

**Recommendation:** [Your recommendation here]`,
    },
    { type: 'text-cell-h2', content: 'Data Overview' },
    {
      type: 'code',
      content: `import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

# Load data
# df = pd.read_csv('data.csv')
# print(f"Dataset: {len(df)} rows, {len(df.columns)} columns")
# df.describe()`,
    },
    { type: 'text-cell-h2', content: 'Key Findings' },
    { type: 'text-cell-h3', content: 'Finding 1: [Title]' },
    {
      type: 'markdown',
      content: 'Description of the first key finding and its implications.',
    },
    {
      type: 'code',
      content: `# Visualization or analysis supporting Finding 1
# plt.figure(figsize=(10, 6))
# ...
# plt.show()`,
    },
    { type: 'text-cell-h3', content: 'Finding 2: [Title]' },
    {
      type: 'markdown',
      content: 'Description of the second key finding and its implications.',
    },
    {
      type: 'code',
      content: `# Visualization or analysis supporting Finding 2
# plt.figure(figsize=(10, 6))
# ...
# plt.show()`,
    },
    { type: 'text-cell-h2', content: 'Conclusions & Recommendations' },
    {
      type: 'markdown',
      content: `### Conclusions

Based on our analysis:
1. Conclusion 1
2. Conclusion 2

### Recommendations

We recommend the following actions:
1. **Action 1**: Description
2. **Action 2**: Description

### Next Steps

- Next step 1
- Next step 2`,
    },
  ],
  api_client: [
    { type: 'text-cell-h1', content: 'API Client' },
    { type: 'markdown', content: 'API integration with authentication, requests, and data processing.' },
    { type: 'text-cell-h2', content: 'Configuration' },
    {
      type: 'input-text',
      content: '',
      metadata: {
        deepnote_variable_name: 'api_base_url',
        deepnote_input_label: 'API Base URL',
        deepnote_input_default: 'https://api.example.com',
        deepnote_variable_value: 'https://api.example.com',
      },
    },
    {
      type: 'input-text',
      content: '',
      metadata: {
        deepnote_variable_name: 'api_key',
        deepnote_input_label: 'API Key',
        deepnote_input_default: '',
        deepnote_variable_value: '',
      },
    },
    {
      type: 'button',
      content: '',
      metadata: {
        deepnote_variable_name: 'refresh_data',
        deepnote_button_label: 'Refresh Data',
      },
    },
    { type: 'text-cell-h2', content: 'API Client Setup' },
    {
      type: 'code',
      content: `import requests
import pandas as pd
from datetime import datetime
import time

class APIClient:
    def __init__(self, base_url, api_key):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        })
    
    def get(self, endpoint, params=None, retries=3):
        """GET request with retry logic."""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        for attempt in range(retries):
            try:
                response = self.session.get(url, params=params, timeout=30)
                response.raise_for_status()
                return response.json()
            except requests.RequestException as e:
                if attempt == retries - 1:
                    raise
                time.sleep(2 ** attempt)  # Exponential backoff
        return None

client = APIClient(api_base_url, api_key)
print(f"✓ API client configured for {api_base_url}")`,
    },
    { type: 'text-cell-h2', content: 'Fetch Data' },
    {
      type: 'code',
      content: `# Fetch data from API
print(f"[{datetime.now()}] Fetching data...")

try:
    # Example: Fetch list of items
    # data = client.get('/items', params={'limit': 100})
    
    # Example: Convert to DataFrame
    # df = pd.DataFrame(data['items'])
    # print(f"✓ Fetched {len(df)} records")
    # df.head()
    
    print("Configure the API endpoint above and uncomment the code")
except Exception as e:
    print(f"✗ API request failed: {e}")`,
    },
    { type: 'text-cell-h2', content: 'Process & Analyze' },
    {
      type: 'code',
      content: `# Process the fetched data
# df['processed_column'] = df['raw_column'].apply(lambda x: x.upper())

# Display summary
# print(f"Data summary:")
# print(df.describe())`,
    },
  ],
}
