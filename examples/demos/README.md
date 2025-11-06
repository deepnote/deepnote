# 🚀 Deepnote Demo Projects

Premium examples showcasing the full power of Deepnote programmatic execution.

---

## 📊 Sales Analytics Dashboard

**File:** `sales_analytics_dashboard.deepnote`

A **complete, production-ready** sales analytics and ML forecasting system that demonstrates EVERY capability of Deepnote.

### 🎯 What's Inside

#### **3 Interconnected Notebooks:**

1. **Data Generation & Filtering** - Generate synthetic sales data with interactive widgets
2. **Machine Learning & Forecasting** - Train RandomForest models for revenue prediction
3. **Executive Dashboard** - Beautiful visualizations and KPI tracking

#### **Features Demonstrated:**

✅ **Code Blocks**

- Data generation with pandas/numpy
- Machine learning with scikit-learn
- Beautiful visualizations with matplotlib/seaborn
- Time series analysis with moving averages

✅ **Init Notebooks**

- Auto-dependency installation
- Smart requirements.txt generation
- Kernel environment setup

✅ **Input Widgets** (Interactive Filtering)

- 🎚️ Region selector (dropdown)
- 🎚️ Product category selector (dropdown)
- 🎚️ Revenue threshold slider ($0 - $50k)

✅ **SQL Analytics with DuckDB**

- Query pandas DataFrames with SQL
- Product performance analysis
- Regional trend analysis
- Aggregations and grouping

✅ **Machine Learning Pipeline**

- Feature engineering (time-based features)
- Random Forest regression
- Model evaluation (MAE, R² scores)
- Feature importance analysis
- Prediction visualizations

✅ **Professional Visualizations**

- Multi-panel dashboard (6 charts)
- Time series with moving averages
- Actual vs Predicted scatter plots
- Revenue distributions (box plots)
- Regional pie charts
- Product performance bars

### 📈 Key Metrics Calculated

- Total Revenue
- Transaction Count
- Average Transaction Value
- Month-over-Month Growth
- Units Sold
- Top Products/Regions

### 🎨 Visualizations Included

1. **Revenue by Product** (Bar Chart)
2. **Regional Distribution** (Pie Chart)
3. **Monthly Trends** (Dual-axis Line Chart)
4. **Top Products by Units** (Horizontal Bar)
5. **Revenue Distribution** (Box Plot)
6. **Actual vs Predicted Sales** (Scatter Plot)
7. **Feature Importance** (Horizontal Bar)
8. **Time Series with Moving Averages** (Line Chart with 7-day and 30-day MA)

### 🗄️ SQL Queries

```sql
-- Top Products by Revenue
SELECT
    product,
    COUNT(*) as transaction_count,
    SUM(quantity) as total_units_sold,
    ROUND(SUM(revenue), 2) as total_revenue,
    ROUND(AVG(revenue), 2) as avg_revenue_per_transaction
FROM df_filtered
GROUP BY product
ORDER BY total_revenue DESC

-- Regional Performance
SELECT
    region,
    COUNT(DISTINCT product) as products_sold,
    ROUND(SUM(revenue), 2) as total_revenue,
    ROUND(AVG(unit_price), 2) as avg_unit_price
FROM df_filtered
GROUP BY region
ORDER BY total_revenue DESC
```

### 🚀 How to Run

#### Via VS Code/Cursor Extension (Manual):

1. Open `sales_analytics_dashboard.deepnote` in VS Code/Cursor
2. Select the Deepnote Kernel
3. Run all notebooks (Cmd/Ctrl + Alt + Shift + Enter)

#### Programmatically (Script):

```bash
# Make sure you have a .deepnote file open with active kernel first!
python scripts/execute-deepnote.py examples/demos/sales_analytics_dashboard.deepnote
```

### 📦 Auto-Installed Dependencies

The init notebook automatically generates and installs:

- `pandas` - Data manipulation
- `numpy` - Numerical computing
- `matplotlib` - Plotting
- `seaborn` - Statistical visualizations
- `scikit-learn` - Machine learning
- `duckdb` - SQL on DataFrames

### 💡 Use Cases

This demo can be adapted for:

- **E-commerce Analytics** - Track product performance
- **Financial Dashboards** - Revenue and profit analysis
- **Sales Forecasting** - Predict future revenue
- **Business Intelligence** - Executive reporting
- **Marketing Analytics** - Campaign performance
- **Operational Metrics** - KPI tracking

### 🎓 Learning Outcomes

After running this demo, you'll understand:

- How to structure multi-notebook projects
- Init notebook patterns for dependencies
- Interactive filtering with input widgets
- SQL analytics on in-memory DataFrames
- End-to-end ML pipelines in notebooks
- Professional data visualization techniques
- KPI calculation and reporting

### 🔥 What Makes This Demo Special

- **Real-world complexity** - Not just "Hello World"
- **Production patterns** - Actually useful structure
- **Beautiful output** - Professional-grade visualizations
- **Interactive** - Widgets for data exploration
- **Complete pipeline** - Data → ML → Insights
- **Best practices** - Clean code, clear documentation
- **100% automated** - Run with one command

---

## 🏠 Housing Price Prediction

**File:** `housing_price_prediction.deepnote`

Classic ML demo with:

- Housing dataset analysis
- Feature engineering
- Price prediction with sklearn
- Model evaluation
- Beautiful seaborn/matplotlib visualizations

---

## 🚀 Running All Demos

```bash
# Run sales analytics
python scripts/execute-deepnote.py examples/demos/sales_analytics_dashboard.deepnote

# Run housing prediction
python scripts/execute-deepnote.py examples/demos/housing_price_prediction.deepnote
```

**Note:** Requires an active Deepnote Kernel (open any `.deepnote` file in VS Code/Cursor first).

---

Built with 💙 by the Deepnote community
