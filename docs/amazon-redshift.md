---
title: Amazon Redshift
description: Amazon Redshift is a fully managed, petabyte-scale data warehouse service. Deepnote integrates with Redshift seamlessly to bring the cloud data warehouse to your notebook.
noIndex: false
noContent: false
---

## What can you do with the Redshift integration?

The Redshift integration allows you to query databases and explore the structure of your warehouse. Think "SQL editor" but with all the modern productivity boosters that come with Deepnote's notebook. For example:

- Write native SQL and Python in the same notebook
- Search your entire warehouse instantly via the integrated schema explorer
- Get intelligent autocomplete for columns, tables, and databases
- Interactively explore data without writing any additional code

<Callout status="info">
Available on Team and Enterprise plans
</Callout>

## How to connect to Redshift

From the right-hand panel, under **Integrations**, click the **+** button and choose **Create new integration**.
![create_integration.png](https://media.graphassets.com/pIr2x2wQtyVUUAv6spVZ)

<br></br>

Select Redshift from the list of integrations or search for it using the search bar.
![redshift_create.png](https://media.graphassets.com/URRAjyZfS6O5tB97TbTa)

<br></br>

Fill out the fields in the pop-up form. You will need to know the Redshift hostname, which can be found on your AWS Redshift console.
![redshift_modal.png](https://media.graphassets.com/TVXyXrdSqa0ID0RB9skT)

<br></br>

<Callout status="success">
Please see our [security options](securing-connections) for configuring access to your Redshift data. This includes securing connections to Redshift via [SSH tunnels](/docs/secure-connections). Note that connections to Redshift will always be secured with SSL.
</Callout>

### Authenticating using an IAM role

Using an IAM role instead of a username and password to connect to your Redshift is preferred for enhanced security and making it easier to manage. IAM roles offer temporary credentials that automatically rotate, reducing the risk of long-term credential exposure. This approach also simplifies permissions management, allowing for more granular access control to Redshift resources based on the principle of least privilege. Moreover, it eliminates the need to store static credentials, reducing the potential for security breaches.

Select the IAM role option in the "Authentication" section in the dropdown menu.

Enter the Amazon Resource Name (ARN) of the AWS role you wish to use for this integration. This role should be configured with the necessary permissions to access the Redshift clusters with which Deepnote will interact.

To allow Deepnote to access your Redshift cluster, you will need to update the role's trust policy. Copy the generated trust policy and update your role's trust relationship in the AWS IAM console.

The Deepntote integration will create a database user called `IAMA:deepnote` that will be used to perform your queries. If you are using serverless Redshift, the user will have the same role as the IAM you used to authenticate. For example, if your IAM role is named `Deepnote-Redshift`, the user will be named `IAMA:Deepnote-Redshift`.

### Authenticating using Individual credentials

Suppose you want to control what data your users can access in your Redshift database. In that case, you can create unique database users for your users and use the Individual credentials option for authentication.

With Individual credentials, each user must authenticate with the database using their credentials before running their first query. The results of their queries will not be shared with other users in the notebook or project.

The user credentials are encrypted before they are stored in Deepnote's database and inaccessible to others.

<Embed url='https://www.loom.com/embed/b6ef8fc726d1485ba307f92da5138ef6?hide_owner=true&hide_share=true&hide_title=true&hideEmbedTopBar=true' />

### AWS PrivateLink

<Callout status="info">
Available only on Enterprise license with single tenant deployment
</Callout>

Deepnote supports connecting to Redshift instances via [AWS PrivateLink](https://docs.aws.amazon.com/redshift/latest/mgmt/security-private-link.html), which allows private connectivity between Deepnote and your Redshift instance without exposing your data to the public internet.

If you wish to try connecting to Redshift without an Enterprise license, we recommend:

- Using a temporary SSH bastion with a public IP address (see [SSH tunnels](/docs/secure-connections))
- Contacting our support team for an enterprise trial with PrivateLink configuration

## Connecting to Redshift with Python

Simple as installing the connector.
`pip install redshift_connector`

```python
import redshift_connector
conn = redshift_connector.connect(
     host='your_host',
     database='your_db',
     port=5439,
     user='your_user',
     password='your_password'
  )

# Create a Cursor object
cursor = conn.cursor()

# Query a table using the Cursor
cursor.execute("select * from book")

#Retrieve the query result set
result: tuple = cursor.fetchall()
print(result)
 (['One Hundred Years of Solitude', 'Gabriel García Márquez'], ['A Brief History of Time', 'Stephen Hawking'])
```

## Using Redshift in Deepnote

Now that you're connected to Redshift, you can do the following:

- Click the newly created integration in the **Integrations** section to open the schema browser. [Click here to learn more about the schema browser](schema-browser).

- Create an SQL block that points to your warehouse and queries your data. Autocomplete for columns, tables, and databases will be at your fingertips as you type. [Click here to learn more about SQL blocks](sql-cells).

- Explore column distributions as well as sorting and filtering capabilities on the results set. All results are displayed as an interactive pandas DataFrame. [Click here to learn about interactive DataFrame output](variable-explorer#interactive-dataframe-output).

- Pipe the results of your query into a chart block for rapid interactive data visualization. [Click here to learn more about chart blocks](chart-blocks).
