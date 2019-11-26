import React from 'react'
import PropTypes from 'prop-types'
import { ReactiveComponent } from 'oo7-react'
import { Button } from 'semantic-ui-react'
import { DataTable } from '../components/ListFactory'
import { closeModal, showForm } from '../services/modal'
import ProductForm from '../forms/Product'

function validateTitle(_, { value }) {
    const { data } = this.state
    const exists = data.find(({ title }) => title.toLowerCase() === value.trim().toLowerCase())
    return !exists ? null : 'Product name already exists'
}

export default class ProductList extends ReactiveComponent {
    constructor(props) {
        super(props)

        this.state = {
            columns: [
                { key: 'id', title: 'ID' },
                { key: 'title', title: 'Title' },
                { key: 'price', title: 'Price' },
                { key: 'description', title: 'Description' },
                {
                    title: 'Actions',
                    content: product => (
                        <Button
                            content='Update'
                            icon='pencil'
                            onClick={() => {
                                const formId = showForm(ProductForm, {
                                    onSubmit: (_, values) => {
                                        const { id } = values
                                        const { data } = this.state
                                        const index = data.findIndex(p => p.id === id)
                                        data[index] = { ...product, ...values }
                                        closeModal(formId)
                                        this.setState({ data })
                                    },
                                    validateTitle: validateTitle.bind(this),
                                    values: product,
                                })
                            }}
                        />
                    )
                }
            ],
            data: props.data,
            searchExtraKeys: ['category'],
            selectable: true,
            topLeftMenu: [
                {
                    content: 'Create',
                    icon: 'plus',
                    onClick: () => {
                        const formId = showForm(ProductForm, {
                            onSubmit: (_, values) => {
                                const { data } = this.state
                                data.push({ ...values, id: data.length })
                                closeModal(formId)
                                this.setState({ data })
                            },
                            validateTitle: validateTitle.bind(this),
                        })
                    }
                }
            ],
            topRightMenu: [
                {
                    content: 'Add to cart',
                    icon: 'add to cart',
                    onClick: (selectedIndexes) => {
                        const { data } = this.props
                        const products = selectedIndexes.map(i => data[i])
                        console.log({ products })
                    }
                }
            ],
        }
    }

    render() {
        return <DataTable {...{ ...this.props, ...this.state }} />
    }
}
ProductList.defaultProps = {
    data: new Array(20).fill(0).map((_, i) => ({
        id: i,
        title: 'Product ' + i,
        price: 99.99,
        description: 'This is product ' + i,
        category: i % 2 === 0 ? 'clothes' : 'home'
    }))
}